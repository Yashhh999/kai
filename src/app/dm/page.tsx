'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { getKeyManager } from '@/lib/crypto/keyManager';
import { Identicon } from '@/lib/identicon';
import { Rendezvous, bundleToWire, bundleFromWire } from '@/lib/crypto/rendezvous';
import {
  generatePreKeyBundle,
  initiateSession,
  respondSession,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeRatchet,
  RatchetState,
  PreKeySecrets,
  InitialMessage,
} from '@/lib/crypto/ratchet';
import { DirectEnvelopeV2 } from '@/lib/crypto/protocol';
import { computeSafetyNumber, formatSafetyNumber } from '@/lib/crypto/safetyNumber';
import {
  PublicIdentity,
  toPublicIdentity,
  computeFingerprint,
  formatFingerprint,
  shortId,
} from '@/lib/crypto/identity';
import { utf8ToBytes, bytesToUtf8, base64ToBytes } from '@/lib/crypto/wire';

interface DmMessage {
  mine: boolean;
  text: string;
  ts: number;
}

function DmInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [myId, setMyId] = useState('');
  const [peerInput, setPeerInput] = useState('');
  const [activePeer, setActivePeer] = useState('');
  const [threads, setThreads] = useState<Record<string, DmMessage[]>>({});
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState('');
  const [showSafety, setShowSafety] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const rzRef = useRef<Rendezvous | null>(null);
  const secretsRef = useRef<PreKeySecrets | null>(null);
  const sessionsRef = useRef<Map<string, RatchetState>>(new Map());
  const peerIdentitiesRef = useRef<Map<string, PublicIdentity>>(new Map());

  const appendMsg = (peer: string, m: DmMessage) => {
    setThreads((prev) => ({ ...prev, [peer]: [...(prev[peer] || []), m] }));
    // Persist to the PIN-sealed store so history survives reloads and shows in Recent.
    const km = getKeyManager();
    km.appendDmMessage(peer, m).catch(() => {});
    km.upsertConversation({ id: `dm:${peer}`, kind: 'dm', peer, label: shortId(peer), lastActivity: Date.now() }).catch(() => {});
  };

  useEffect(() => {
    const km = getKeyManager();
    if (!km.hasSealedStore() || !km.isUnlocked()) {
      router.push('/');
      return;
    }
    const self = km.getIdentity();
    setMyId(self.fingerprint);

    // Load persisted DM history + contacts, and auto-select a peer from ?peer=.
    const stored: Record<string, DmMessage[]> = {};
    for (const c of km.getConversations()) {
      if (c.kind === 'dm' && c.peer) stored[c.peer] = km.getDmHistory(c.peer);
    }
    if (Object.keys(stored).length) setThreads(stored);
    const qp = searchParams.get('peer');
    if (qp) setActivePeer(qp.replace(/[-\s]/g, '').toUpperCase());

    const url =
      process.env.NEXT_PUBLIC_API_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
    const socket = io(url, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    const rz = new Rendezvous(socket);
    rzRef.current = rz;

    const { bundle, secrets } = generatePreKeyBundle(self);
    secretsRef.current = secrets;

    socket.on('connect', () => {
      rz.register(self.fingerprint, bundleToWire(bundle));
      setReady(true);
    });

    const offInit = rz.onDmInit(async ({ from, init, envelope }) => {
      try {
        const initMsg = init as InitialMessage;
        const state = respondSession(self, secretsRef.current!, initMsg);
        const dec = await ratchetDecrypt(state, envelope as DirectEnvelopeV2);
        sessionsRef.current.set(from, dec.state);
        km.saveSession(from, serializeRatchet(dec.state)).catch(() => {});
        // Capture the initiator's public identity (carried in the init message).
        const signPub = base64ToBytes(initMsg.identitySignPub);
        const dhPub = base64ToBytes(initMsg.identityDhPub);
        if (computeFingerprint(signPub, dhPub) === from) {
          peerIdentitiesRef.current.set(from, { signPub, dhPub, fingerprint: from });
        }
        appendMsg(from, { mine: false, text: bytesToUtf8(dec.plaintext), ts: Date.now() });
        setActivePeer((prev) => prev || from);
      } catch (e) {
        console.error('dm-init decrypt failed', e);
      }
    });

    const offRecv = rz.onDmReceive(async ({ from, envelope }) => {
      const state = sessionsRef.current.get(from);
      if (!state) return;
      try {
        const dec = await ratchetDecrypt(state, envelope as DirectEnvelopeV2);
        sessionsRef.current.set(from, dec.state);
        km.saveSession(from, serializeRatchet(dec.state)).catch(() => {});
        appendMsg(from, { mine: false, text: bytesToUtf8(dec.plaintext), ts: Date.now() });
      } catch (e) {
        console.error('dm decrypt failed', e);
      }
    });

    const offErr = rz.onDmError(({ to, reason }) => setStatus(`${to.slice(0, 8)}…: ${reason}`));

    return () => {
      offInit();
      offRecv();
      offErr();
      rz.unregister();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const startOrSend = async () => {
    const km = getKeyManager();
    const self = km.getIdentity();
    const rz = rzRef.current;
    if (!rz) return;
    const peer = (activePeer || peerInput).replace(/[-\s]/g, '').toUpperCase();
    if (!peer) return;
    const text = draft.trim();
    const existing = sessionsRef.current.get(peer);
    if (!text && existing) return;

    try {
      if (!existing) {
        setStatus('Looking up user…');
        const wire = await rz.lookup(peer);
        if (!wire) {
          setStatus('User is offline or not found.');
          return;
        }
        const bundle = bundleFromWire(wire);
        peerIdentitiesRef.current.set(peer, bundle.identity);
        const { state, init } = initiateSession(self, bundle);
        const enc = await ratchetEncrypt(state, utf8ToBytes(text || '👋'));
        sessionsRef.current.set(peer, enc.state);
        km.saveSession(peer, serializeRatchet(enc.state)).catch(() => {});
        rz.sendDmInit(peer, init, enc.env);
        appendMsg(peer, { mine: true, text: text || '👋', ts: Date.now() });
        setActivePeer(peer);
        setPeerInput('');
        setDraft('');
        setStatus('');
        return;
      }
      const enc = await ratchetEncrypt(existing, utf8ToBytes(text));
      sessionsRef.current.set(peer, enc.state);
      km.saveSession(peer, serializeRatchet(enc.state)).catch(() => {});
      rz.sendDmRelay(peer, enc.env);
      appendMsg(peer, { mine: true, text, ts: Date.now() });
      setDraft('');
    } catch (e) {
      console.error('DM send failed', e);
      setStatus('Could not send.');
    }
  };

  const contacts = Object.keys(threads);
  const activeMessages = activePeer ? threads[activePeer] || [] : [];
  const peerIdentity = activePeer ? peerIdentitiesRef.current.get(activePeer) : undefined;
  const safetyNumber =
    peerIdentity && myId
      ? computeSafetyNumber(toPublicIdentity(getKeyManager().getIdentity()), peerIdentity)
      : '';

  return (
    <div className="flex flex-col h-screen bg-black text-neutral-100">
      <div className="border-b border-neutral-900 bg-black/50 backdrop-blur-xl p-3 sm:p-4 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-white">Direct Messages</h1>
          <p className="text-[11px] text-neutral-500 font-mono truncate">
            You: {myId ? formatFingerprint(myId) : '…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {safetyNumber && (
            <button
              onClick={() => setShowSafety(!showSafety)}
              className="px-2.5 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs hover:bg-emerald-500/20"
            >
              Verify
            </button>
          )}
          <button
            onClick={() => router.push('/')}
            className="px-3 py-1.5 text-xs text-neutral-500 hover:text-white border border-neutral-800/50 rounded-lg"
          >
            Home
          </button>
        </div>
      </div>

      {showSafety && safetyNumber && (
        <div className="p-3 bg-neutral-900/70 border-b border-neutral-800">
          <p className="text-xs font-semibold text-emerald-400 mb-1">SAFETY NUMBER</p>
          <p className="text-[11px] text-neutral-500 mb-2">
            Compare out-of-band with {formatFingerprint(activePeer)} to confirm no interception.
          </p>
          <div className="font-mono text-xs bg-black/50 border border-neutral-800 rounded-lg p-2 break-all select-all">
            {formatSafetyNumber(safetyNumber)}
          </div>
        </div>
      )}

      <div className="p-3 border-b border-neutral-900 flex gap-2">
        <input
          value={activePeer || peerInput}
          onChange={(e) => {
            setActivePeer('');
            setPeerInput(e.target.value);
          }}
          placeholder="Enter a User ID to message"
          className="flex-1 bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-white/40"
        />
        {contacts.length > 0 && (
          <select
            value={activePeer}
            onChange={(e) => {
              setActivePeer(e.target.value);
              setPeerInput('');
            }}
            className="bg-black/50 border border-neutral-800 rounded-lg px-2 py-2 text-xs"
          >
            <option value="">— chats —</option>
            {contacts.map((c) => (
              <option key={c} value={c}>
                {c.slice(0, 8)}…
              </option>
            ))}
          </select>
        )}
      </div>

      {status && <div className="px-4 py-1.5 text-xs text-amber-400">{status}</div>}

      {activePeer && (
        <div className="px-4 py-2 border-b border-neutral-900 flex items-center gap-2 bg-neutral-950/50">
          <Identicon seed={activePeer} size={28} />
          <span className="text-xs font-mono text-neutral-400 truncate">{formatFingerprint(activePeer)}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {!ready && <p className="text-neutral-600 text-sm">Connecting…</p>}
        {ready && activeMessages.length === 0 && (
          <p className="text-neutral-600 text-sm">
            {activePeer || peerInput
              ? 'No messages yet. Both parties must be online (no offline delivery).'
              : 'Enter a User ID above to start an encrypted 1:1 chat.'}
          </p>
        )}
        {activeMessages.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.mine ? 'justify-end' : 'justify-start'}`}>
            {!m.mine && activePeer && <Identicon seed={activePeer} size={24} className="shrink-0" />}
            <div
              className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                m.mine ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-100'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-neutral-900 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') startOrSend();
          }}
          placeholder={sessionsRef.current.has(activePeer) ? 'Message' : 'Message (starts the chat)'}
          className="flex-1 bg-black/50 border border-neutral-800 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
        />
        <button
          onClick={startOrSend}
          disabled={!ready}
          className="px-5 py-2.5 bg-white text-black rounded-full text-sm font-medium hover:bg-neutral-200 active:scale-95 transition-all disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function DmPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-black" />}>
      <DmInner />
    </Suspense>
  );
}

'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import Peer from 'simple-peer';
import ChatMessages from '@/components/ChatMessages';
import ChatInput from '@/components/ChatInput';
import RoomHeader from '@/components/RoomHeader';
import VoiceChannel, { VoiceChannelRef } from '@/components/VoiceChannel';
import { deriveRoomContext, roomContextFromKey, RoomContext } from '@/lib/crypto/room';
import { GroupSession, MissingSenderKeyError } from '@/lib/crypto/groupSession';
import { getKeyManager } from '@/lib/crypto/keyManager';
import { deriveKeyLegacy, decryptMessageLegacy } from '@/lib/crypto/legacy';
import { detectVersion, RoomEnvelopeV2 } from '@/lib/crypto/protocol';
import { roomSafetyNumber as computeRoomSafetyNumber } from '@/lib/crypto/safetyNumber';
import { encryptRoomBlob, decryptRoomBlob } from '@/lib/crypto/fileTransfer';
import { utf8ToBytes, bytesToUtf8, bytesToBase64 } from '@/lib/crypto/wire';
import { formatRoomCode } from '@/lib/roomCode';
import { saveRoomData, loadRoomData, Message, getUserPreferences, saveUserPreferences, migrateLegacyRoom } from '@/lib/storage';
import { readStashedInvite } from '@/lib/inviteSession';
import InviteModal from '@/components/InviteModal';
import { prepareFile, isFileTooLarge } from '@/lib/fileUtils';

interface RoomUser {
  id: string;
  name: string;
  lastSeen: number;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.roomCode as string;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [cryptoReady, setCryptoReady] = useState(false);
  // v2 crypto: room context (routingId + room key), group session, and the
  // storage key (routingId — never the raw room code). Held in refs so socket
  // callbacks always see the latest without re-subscribing.
  const roomCtxRef = useRef<RoomContext | null>(null);
  const groupRef = useRef<GroupSession | null>(null);
  const routingIdRef = useRef<string>('');
  // Mirrored to state for props that must re-render when crypto becomes ready.
  const [routingId, setRoutingId] = useState('');
  const [roomKeyBytes, setRoomKeyBytes] = useState<Uint8Array | null>(null);
  const [roomSafetyNum, setRoomSafetyNum] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  // True when we joined via an invite (URL param is a routingId, not a room code).
  const inviteModeRef = useRef(false);
  // Envelopes that arrived before their sender's key distribution, keyed by sid:epoch.
  const pendingGroupRef = useRef<Map<string, any[]>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [username, setUsername] = useState('');
  const [extendedRetention, setExtendedRetention] = useState(false);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [transferMode, setTransferMode] = useState<'p2p' | 'direct' | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);
  const [hasLoadedFromStorage, setHasLoadedFromStorage] = useState(false);
  const [isInVoice, setIsInVoice] = useState(false);
  const [voiceParticipantCount, setVoiceParticipantCount] = useState(0);
  const peersRef = useRef<Map<string, Peer.Instance>>(new Map());
  const voiceChannelRef = useRef<VoiceChannelRef>(null);

  // --- Effect A: initialize v2 crypto (identity must be unlocked). ---
  useEffect(() => {
    if (!roomCode) {
      router.push('/');
      return;
    }
    const prefs = getUserPreferences();
    if (!prefs.username) {
      router.push('/');
      return;
    }
    const km = getKeyManager();
    if (!km.hasSealedStore() || !km.isUnlocked()) {
      // Identity not set up / locked — send the user home to unlock first.
      router.push('/');
      return;
    }

    setUsername(prefs.username);
    setExtendedRetention(prefs.extendedRetention);

    let cancelled = false;
    (async () => {
      // Invite mode: the URL param is a routingId and the room key was stashed by the
      // landing page during redemption. Otherwise the param is a room code we derive from.
      const stashed = readStashedInvite(roomCode);
      inviteModeRef.current = !!stashed;
      const ctx = stashed
        ? await roomContextFromKey(roomCode, stashed.roomKeyBytes)
        : await deriveRoomContext(roomCode);
      if (cancelled) return;
      roomCtxRef.current = ctx;
      routingIdRef.current = ctx.routingId;
      setRoutingId(ctx.routingId);
      setRoomKeyBytes(ctx.roomKeyBytes);
      setRoomSafetyNum(computeRoomSafetyNumber(ctx.roomSafetySeed));

      // Remember this room so it appears in "Recent" and can be reopened without the
      // code. Store the room key (sealed) for keyed reopen; keep the code for code-rooms.
      km.upsertConversation({
        id: ctx.routingId,
        kind: 'room',
        routingId: ctx.routingId,
        code: stashed ? undefined : roomCode,
        roomKeyBytes: bytesToBase64(ctx.roomKeyBytes),
        label: stashed ? 'Invited room' : formatRoomCode(roomCode),
        lastActivity: Date.now(),
      }).catch(() => {});

      // Migrate any legacy room-code-keyed cache into the routingId cache (code mode only).
      if (!stashed) await migrateLegacyRoom(roomCode, ctx.routingId);

      const existing = loadRoomData(ctx.routingId);
      if (existing) {
        setMessages(existing.messages);
        setExtendedRetention(existing.extendedRetention);
        setHasLoadedFromStorage(true);
      }

      const restore = km.loadSenderKey(ctx.routingId) ?? undefined;
      const gs = await GroupSession.create(ctx.roomKeyBytes, km.getIdentity(), { restore });
      if (cancelled) return;
      groupRef.current = gs;
      km.saveSenderKey(ctx.routingId, gs.serializeOwn()).catch(() => {});
      setCryptoReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [roomCode, router]);

  // --- Effect B: socket lifecycle (join by routingId, presence, distributions). ---
  useEffect(() => {
    if (!cryptoReady || !roomCtxRef.current || !groupRef.current) return;
    const group = groupRef.current;
    const routingId = routingIdRef.current;
    const prefs = getUserPreferences();

    const getSocketUrl = () => {
      if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
      if (typeof window !== 'undefined') return window.location.origin;
      return 'http://localhost:3000';
    };

    const socketInstance = io(getSocketUrl(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    const sendDistribution = (to?: string) =>
      socketInstance.emit('sender-key', { roomId: routingId, to, payload: group.distribution() });

    socketInstance.on('connect', () => {
      setIsConnected(true);
      socketInstance.emit('join-room', { roomId: routingId, username: prefs.username, v: 2 });
      sendDistribution(); // announce our sender key to the whole room
    });

    socketInstance.on('disconnect', () => setIsConnected(false));

    socketInstance.on('users-update', (usersList: RoomUser[]) => setUsers(usersList));

    // Send our current sender-key distribution to any newcomer.
    socketInstance.on('user-joined', ({ id }: { id: string }) => sendDistribution(id));

    socketInstance.on('user-typing', ({ username: typingUsername, isTyping }: any) => {
      setTypingUsers(prev => {
        const next = new Set(prev);
        if (isTyping) next.add(typingUsername);
        else next.delete(typingUsername);
        return next;
      });
    });

    setSocket(socketInstance);

    const heartbeat = setInterval(() => socketInstance.emit('heartbeat', { roomId: routingId }), 30000);

    return () => {
      clearInterval(heartbeat);
      socketInstance.emit('leave-room', routingId);
      socketInstance.disconnect();
    };
  }, [cryptoReady]);

  useEffect(() => {
    if (!cryptoReady || !socket || !groupRef.current || !roomCtxRef.current) return;
    const group = groupRef.current;
    const roomKeyBytes = roomCtxRef.current.roomKeyBytes;
    const routingId = routingIdRef.current;

    const appendMessage = (newMessage: Message) => {
      setMessages(prev => {
        if (prev.some(m => m.senderId === newMessage.senderId && m.timestamp === newMessage.timestamp)) return prev;
        const updated = [...prev, newMessage];
        saveRoomData(routingId, updated, extendedRetention);
        return updated;
      });
    };

    const renderText = (content: string, d: any) =>
      appendMessage({
        id: `${d.senderId}-${d.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
        content,
        senderId: d.senderId,
        senderName: d.senderName,
        timestamp: d.timestamp,
        isSent: false,
        selfDestruct: d.selfDestruct,
        timerStartedAt: d.timerStartedAt,
      });

    const bufferPending = (sid: string, epoch: number, data: any) => {
      const key = `${sid}:${epoch}`;
      const arr = pendingGroupRef.current.get(key) ?? [];
      arr.push(data);
      pendingGroupRef.current.set(key, arr);
    };

    const drainPending = async () => {
      for (const [key, arr] of Array.from(pendingGroupRef.current.entries())) {
        const [sid, epochStr] = key.split(':');
        if (!group.hasSenderFor(sid, Number(epochStr))) continue;
        pendingGroupRef.current.delete(key);
        for (const data of arr) {
          try {
            const { plaintext } = await group.decrypt(data.encryptedMessage as RoomEnvelopeV2);
            renderText(bytesToUtf8(plaintext), data);
          } catch (e) {
            console.error('Buffered decrypt failed:', e);
          }
        }
      }
      getKeyManager().saveSenderKey(routingId, group.serializeOwn()).catch(() => {});
    };

    const handleSenderKey = async ({ payload }: { from: string; payload: string }) => {
      try {
        await group.adopt(payload);
        await drainPending();
      } catch (e) {
        console.error('sender-key adopt failed:', e);
      }
    };

    const handleReceiveMessage = async (data: any) => {
      const env = data.encryptedMessage;
      try {
        if (detectVersion(env) === 2 && env?.k === 'room') {
          try {
            const { plaintext } = await group.decrypt(env as RoomEnvelopeV2);
            renderText(bytesToUtf8(plaintext), data);
            getKeyManager().saveSenderKey(routingId, group.serializeOwn()).catch(() => {});
          } catch (e) {
            if (e instanceof MissingSenderKeyError) bufferPending(e.sid, e.epoch, data);
            else console.error('Group decrypt failed:', e);
          }
        } else {
          // Legacy (v1) message from an old client / cache.
          const key = await deriveKeyLegacy(roomCode);
          renderText(await decryptMessageLegacy(env, key), data);
        }
      } catch (error) {
        console.error('Decryption failed:', error);
      }
    };

    const parseFilePayload = async (encryptedFile: any): Promise<any> => {
      // v2: room-key-encrypted blob string ("transferId.iv.ct"). Legacy: {ciphertext, iv}.
      if (typeof encryptedFile === 'string') {
        return JSON.parse(bytesToUtf8(await decryptRoomBlob(roomKeyBytes, encryptedFile)));
      }
      const key = await deriveKeyLegacy(roomCode);
      return JSON.parse(await decryptMessageLegacy(encryptedFile, key));
    };

    const handleFileReceived = async ({ encryptedFile, senderId, senderName, timestamp }: any) => {
      try {
        setIsReceiving(true);
        setDownloadProgress(40);
        const fileData = await parseFilePayload(encryptedFile);
        setDownloadProgress(90);

        appendMessage({
          id: `${senderId}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
          content: '',
          type: 'file',
          file: {
            name: fileData.name,
            size: fileData.size,
            type: fileData.type,
            data: fileData.data,
            thumbnail: fileData.thumbnail,
          },
          senderId,
          senderName,
          timestamp,
          isSent: false,
          viewOnce: fileData.viewOnce,
          viewedBy: [],
          selfDestruct: fileData.selfDestruct,
          downloadable: fileData.downloadable,
          timerStartedAt: (fileData.selfDestruct && !fileData.viewOnce) ? Date.now() : undefined,
        });

        setDownloadProgress(100);
        setTimeout(() => {
          setDownloadProgress(0);
          setIsReceiving(false);
        }, 1000);
      } catch (error) {
        console.error('File receive failed:', error);
        setDownloadProgress(0);
        setIsReceiving(false);
      }
    };

    const handleP2PRequest = ({ from }: any) => {
      const peer = new Peer({ 
        initiator: false, 
        trickle: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        },
        channelConfig: {},
        offerOptions: {},
        answerOptions: {},
        sdpTransform: (sdp: string) => sdp,
        streams: []
      });
      
      setIsReceiving(true);
      setDownloadProgress(10);
      
      const timeout = setTimeout(() => {
        console.error('P2P receive timeout');
        setDownloadProgress(0);
        setIsReceiving(false);
        peer.destroy();
      }, 15000);
      
      peer.on('signal', (signal: any) => {
        setDownloadProgress(30);
        socket.emit('p2p-signal', { to: from, roomId: routingId, signal });
        setDownloadProgress(40);
      });

      peer.on('connect', () => {
        clearTimeout(timeout);
        setDownloadProgress(60);
      });

      peer.on('data', async (data: any) => {
        try {
          setDownloadProgress(75);

          // v2: the data channel carries a room-key-encrypted blob (never plaintext).
          // Fall back to legacy plaintext JSON only if decryption isn't applicable.
          const raw = data.toString();
          let fileData: any;
          try {
            fileData = JSON.parse(bytesToUtf8(await decryptRoomBlob(roomKeyBytes, raw)));
          } catch {
            fileData = JSON.parse(raw);
          }
          setDownloadProgress(90);

          appendMessage({
            id: `${from}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            content: '',
            type: 'file',
            file: {
              name: fileData.name,
              size: fileData.size,
              type: fileData.type,
              data: fileData.data,
              thumbnail: fileData.thumbnail,
            },
            senderId: from,
            senderName: users.find((u: RoomUser) => u.id === from)?.name || 'Unknown',
            timestamp: Date.now(),
            isSent: false,
            viewOnce: fileData.viewOnce,
            viewedBy: [],
            selfDestruct: fileData.selfDestruct,
            downloadable: fileData.downloadable,
            timerStartedAt: (fileData.selfDestruct && !fileData.viewOnce) ? Date.now() : undefined,
          });

          setDownloadProgress(100);
          setTimeout(() => {
            setDownloadProgress(0);
            setIsReceiving(false);
          }, 1000);
        } catch (error) {
          console.error('P2P file receive error:', error);
          setDownloadProgress(0);
          setIsReceiving(false);
        }
      });

      peer.on('error', (err) => {
        clearTimeout(timeout);
        console.error('P2P receive error:', err);
        setDownloadProgress(0);
        setIsReceiving(false);
      });

      peersRef.current.set(from, peer);
    };

    const handleP2PSignal = ({ from, signal }: any) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        try {
          peer.signal(signal);
          if (transferMode === 'p2p') {
            setUploadProgress(prev => Math.min(prev + 5, 55));
          }
          if (isReceiving) {
            setDownloadProgress(prev => Math.min(prev + 5, 55));
          }
        } catch (err) {
          console.error('Signal error:', err);
        }
      }
    };

    socket.on('sender-key', handleSenderKey);
    socket.on('receive-message', handleReceiveMessage);
    socket.on('receive-file', handleFileReceived);
    socket.on('p2p-request', handleP2PRequest);
    socket.on('p2p-signal', handleP2PSignal);

    return () => {
      socket.off('sender-key', handleSenderKey);
      socket.off('receive-message', handleReceiveMessage);
      socket.off('receive-file', handleFileReceived);
      socket.off('p2p-request', handleP2PRequest);
      socket.off('p2p-signal', handleP2PSignal);

      peersRef.current.forEach(peer => peer.destroy());
      peersRef.current.clear();
    };
  }, [cryptoReady, socket, roomCode, extendedRetention, users]);

  const handleSendMessage = useCallback(async (content: string, options?: { selfDestruct?: number; attachment?: { file: File; useP2P: boolean; viewOnce?: boolean; selfDestruct?: number; downloadable?: boolean } }) => {
    if (!socket || !cryptoReady || !isConnected || !groupRef.current || !roomCtxRef.current) return;
    const group = groupRef.current;
    const roomKeyBytes = roomCtxRef.current.roomKeyBytes;
    const routingId = routingIdRef.current;
    const attachment = options?.attachment;
    const messageSelfDestruct = options?.selfDestruct;
    if (!content.trim() && !attachment) return;

    try {
      const timestamp = Date.now();

      if (attachment) {
        const prepared = await prepareFile(attachment.file);

        if (attachment.useP2P) {
          setTransferMode('p2p');
          setUploadProgress(10);
          const targetUsers = users.filter((u: RoomUser) => u.id !== socket.id);
          if (targetUsers.length === 0) {
            alert('No other users to send file to');
            setTransferMode(null);
            setUploadProgress(0);
            return;
          }

          for (const user of targetUsers) {
            const peer = new Peer({ 
              initiator: true, 
              trickle: true,
              config: {
                iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:global.stun.twilio.com:3478' }
                ]
              },
              channelConfig: {},
              offerOptions: {},
              answerOptions: {},
              sdpTransform: (sdp: string) => sdp,
              streams: []
            });
            
            const timeout = setTimeout(() => {
              console.error('P2P connection timeout');
              setUploadProgress(0);
              setTransferMode(null);
              peer.destroy();
            }, 15000);

            peer.on('signal', (signal: any) => {
              setUploadProgress(30);
              socket.emit('p2p-signal', { to: user.id, roomId: routingId, signal });
              setUploadProgress(40);
            });

            peer.on('connect', () => {
              clearTimeout(timeout);
              setUploadProgress(60);
              setTimeout(async () => {
                const dataWithOptions = {
                  ...prepared,
                  viewOnce: attachment.viewOnce,
                  selfDestruct: attachment.selfDestruct,
                  downloadable: attachment.downloadable,
                };
                // Encrypt the payload under the room key before it leaves the browser.
                const dataStr = await encryptRoomBlob(roomKeyBytes, utf8ToBytes(JSON.stringify(dataWithOptions)));
                setUploadProgress(80);
                peer.send(dataStr);
                setUploadProgress(95);
                setTimeout(() => {
                  setUploadProgress(100);
                  setTimeout(() => {
                    setUploadProgress(0);
                    setTransferMode(null);
                  }, 1000);
                }, 200);
              }, 100);
            });

            peer.on('error', (err) => {
              clearTimeout(timeout);
              console.error('P2P error:', err);
              setUploadProgress(0);
              setTransferMode(null);
            });

            peersRef.current.set(user.id, peer);
            socket.emit('p2p-request', { to: user.id, roomId: routingId });
          }
        } else {
          setTransferMode('direct');
          const fileDataWithOptions = {
            ...prepared,
            viewOnce: attachment.viewOnce,
            selfDestruct: attachment.selfDestruct,
            downloadable: attachment.downloadable,
          };
          const encrypted = await encryptRoomBlob(roomKeyBytes, utf8ToBytes(JSON.stringify(fileDataWithOptions)));
          socket.emit('send-file', {
            roomId: routingId,
            encryptedFile: encrypted,
            username,
          });
          setTimeout(() => setTransferMode(null), 1000);
        }

        const newMessage: Message = {
          id: `${socket.id}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
          content: content || '',
          type: 'file',
          file: prepared,
          senderId: socket.id!,
          senderName: username,
          timestamp,
          isSent: true,
          viewOnce: attachment.viewOnce,
          viewedBy: [],
          selfDestruct: attachment.selfDestruct,
          downloadable: attachment.downloadable,
          timerStartedAt: (attachment.selfDestruct && !attachment.viewOnce) ? Date.now() : undefined,
        };

        setMessages(prev => {
          const updated = [...prev, newMessage];
          saveRoomData(routingId, updated, extendedRetention);
          return updated;
        });
      } else {
        // Group text: encrypt under our sender-key chain (forward-secret, signed).
        const env = await group.encrypt(utf8ToBytes(content));
        getKeyManager().saveSenderKey(routingId, group.serializeOwn()).catch(() => {});

        socket.emit('send-message', {
          roomId: routingId,
          encryptedMessage: env,
          username,
          selfDestruct: messageSelfDestruct,
          timerStartedAt: messageSelfDestruct ? Date.now() : undefined,
        });

        const newMessage: Message = {
          id: `${socket.id}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
          content,
          senderId: socket.id!,
          senderName: username,
          timestamp,
          isSent: true,
          selfDestruct: messageSelfDestruct,
          timerStartedAt: messageSelfDestruct ? Date.now() : undefined,
        };

        setMessages(prev => {
          const updated = [...prev, newMessage];
          saveRoomData(routingId, updated, extendedRetention);
          return updated;
        });
      }
    } catch (error) {
      console.error('Send failed:', error);
    }
  }, [socket, cryptoReady, isConnected, username, extendedRetention, users]);

  const updateMessageTimer = useCallback((messageId: string, timerStartedAt: number) => {
    setMessages(prev => {
      const updated = prev.map(msg =>
        msg.id === messageId
          ? { ...msg, timerStartedAt }
          : msg
      );
      saveRoomData(routingIdRef.current, updated, extendedRetention);
      return updated;
    });
  }, [extendedRetention]);

  const updateMessageViewedBy = useCallback((messageId: string, userId: string) => {
    setMessages(prev => {
      const updated = prev.map(msg => {
        if (msg.id === messageId) {
          const viewedBy = msg.viewedBy || [];
          if (!viewedBy.includes(userId)) {
            return { ...msg, viewedBy: [...viewedBy, userId] };
          }
        }
        return msg;
      });
      saveRoomData(routingIdRef.current, updated, extendedRetention);
      return updated;
    });
  }, [extendedRetention]);

  const handleTyping = useCallback((isTyping: boolean) => {
    if (!socket || !isConnected) return;
    const routingId = routingIdRef.current;
    if (isTyping) {
      socket.emit('typing-start', { roomId: routingId, username });
    } else {
      socket.emit('typing-stop', routingId);
    }
  }, [socket, isConnected, username]);

  const toggleRetention = useCallback(() => {
    const newRetention = !extendedRetention;
    setExtendedRetention(newRetention);
    saveRoomData(routingIdRef.current, messages, newRetention);

    const prefs = getUserPreferences();
    saveUserPreferences({ ...prefs, extendedRetention: newRetention });
  }, [extendedRetention, messages]);

  const onlineUsers = useMemo(() => {
    const now = Date.now();
    return users.filter((u: RoomUser) => now - u.lastSeen < 60000);
  }, [users]);

  const handleVoiceStateChange = useCallback((inVoice: boolean, participantCount: number) => {
    setIsInVoice(inVoice);
    setVoiceParticipantCount(participantCount);
  }, []);

  return (
    <>
      {showInvite && routingId && roomKeyBytes && (
        <InviteModal
          routingId={routingId}
          roomKeyBytes={roomKeyBytes}
          socket={socket}
          onClose={() => setShowInvite(false)}
        />
      )}
      {routingId && roomKeyBytes && (
        <VoiceChannel
          ref={voiceChannelRef}
          roomCode={routingId}
          roomKeyBytes={roomKeyBytes}
          socket={socket}
          currentUserId={socket?.id || ''}
          currentUsername={username}
          isConnected={isConnected}
          onVoiceStateChange={handleVoiceStateChange}
        />
      )}
      <div className="flex flex-col h-screen bg-black">
        <RoomHeader
          roomCode={roomCode}
          users={onlineUsers}
          extendedRetention={extendedRetention}
          onToggleRetention={toggleRetention}
          voiceChannelRef={voiceChannelRef}
          isInVoice={isInVoice}
          voiceParticipantCount={voiceParticipantCount}
          roomSafetyNumber={roomSafetyNum}
          onInvite={roomKeyBytes ? () => setShowInvite(true) : undefined}
          logoSeed={routingId || undefined}
        />
      <ChatMessages 
        messages={messages} 
        currentUserId={username} 
        onUpdateMessageTimer={updateMessageTimer}
        onUpdateMessageViewedBy={updateMessageViewedBy}
      />
      {typingUsers.size > 0 && (
        <div className="px-6 py-2 text-sm text-neutral-500 animate-pulse">
          <span className="inline-flex items-center gap-2">
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </span>
            {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing
          </span>
        </div>
      )}
      {(uploadProgress > 0 || downloadProgress > 0 || transferMode || isReceiving) && (
        <div className="px-6 py-3 space-y-2 bg-neutral-900/50 border-t border-neutral-900">
          {transferMode && (
            <div className="flex items-center gap-2.5 text-sm">
              {transferMode === 'p2p' ? (
                <>
                  <span className="text-blue-400 animate-pulse">⚡</span>
                  <span className="text-neutral-300 font-medium">P2P transfer {uploadProgress}%</span>
                </>
              ) : (
                <>
                  <span className="text-emerald-400 animate-pulse">🔒</span>
                  <span className="text-neutral-300 font-medium">Encrypting {uploadProgress}%</span>
                </>
              )}
            </div>
          )}
          {isReceiving && (
            <div className="flex items-center gap-2.5 text-sm">
              <span className="text-blue-400 animate-pulse">📥</span>
              <span className="text-neutral-300 font-medium">Receiving {downloadProgress}%</span>
            </div>
          )}
          {uploadProgress > 0 && (
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-300 rounded-full"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
          {downloadProgress > 0 && (
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 rounded-full"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          )}
        </div>
      )}
      <ChatInput 
        onSendMessage={handleSendMessage}
        onTyping={handleTyping}
        disabled={!isConnected} 
      />
      </div>
    </>
  );
}

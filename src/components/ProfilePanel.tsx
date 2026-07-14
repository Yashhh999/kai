'use client';

import { useState } from 'react';
import { X, Copy, Check, Lock } from 'lucide-react';
import { getKeyManager } from '@/lib/crypto/keyManager';
import { formatFingerprint } from '@/lib/crypto/identity';
import { getUserPreferences, saveUserPreferences } from '@/lib/storage';
import { Identicon } from '@/lib/identicon';

interface ProfilePanelProps {
  onClose: () => void;
  onLocked: () => void;
  onUsernameChange?: (name: string) => void;
}

export default function ProfilePanel({ onClose, onLocked, onUsernameChange }: ProfilePanelProps) {
  const km = getKeyManager();
  const fingerprint = km.isUnlocked() ? km.getPublicIdentity().fingerprint : '';
  const prefs = getUserPreferences();
  const [username, setUsername] = useState(prefs.username);
  const [extendedRetention, setExtendedRetention] = useState(prefs.extendedRetention);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const [changingPin, setChangingPin] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState('');

  const save = () => {
    saveUserPreferences({ username: username.trim(), extendedRetention });
    onUsernameChange?.(username.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const copyId = () => {
    navigator.clipboard.writeText(fingerprint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const doChangePin = async () => {
    if (oldPin.length < 4 || newPin.length < 4) {
      setPinMsg('PINs must be at least 4 digits.');
      return;
    }
    setPinBusy(true);
    setPinMsg('');
    try {
      await km.changePin(oldPin, newPin);
      setPinMsg('PIN changed.');
      setChangingPin(false);
      setOldPin('');
      setNewPin('');
    } catch {
      setPinMsg('Current PIN is wrong.');
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-5">
          <h2 className="text-lg font-bold text-white">Profile &amp; Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        <div className="flex items-center gap-4 mb-5">
          {fingerprint && <Identicon seed={fingerprint} size={72} />}
          <div className="min-w-0">
            <p className="text-xs text-neutral-500 mb-1">Your User ID</p>
            <button onClick={copyId} className="flex items-center gap-2 text-emerald-300 font-mono text-xs hover:text-emerald-200 text-left">
              <span className="break-all">{formatFingerprint(fingerprint)}</span>
              {copied ? <Check className="w-3.5 h-3.5 shrink-0" /> : <Copy className="w-3.5 h-3.5 shrink-0" />}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-neutral-300 block mb-1">Username</label>
            <div className="flex gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={20}
                className="flex-1 bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-white/40"
              />
              <button onClick={save} className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-neutral-200">
                {saved ? '✓' : 'Save'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-neutral-800">
            <div>
              <div className="text-sm text-neutral-300 font-medium">Extended Retention</div>
              <div className="text-xs text-neutral-600">7 days instead of 24 hours</div>
            </div>
            <button
              onClick={() => {
                const v = !extendedRetention;
                setExtendedRetention(v);
                saveUserPreferences({ username: username.trim(), extendedRetention: v });
              }}
              className={`w-12 h-6 rounded-full transition-all ${extendedRetention ? 'bg-white' : 'bg-neutral-700'}`}
            >
              <div className={`w-5 h-5 bg-black rounded-full transition-transform shadow-lg ${extendedRetention ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <div className="pt-3 border-t border-neutral-800">
            {!changingPin ? (
              <button onClick={() => setChangingPin(true)} className="text-sm text-neutral-300 hover:text-white">
                Change PIN
              </button>
            ) : (
              <div className="space-y-2">
                <input type="password" inputMode="numeric" value={oldPin} onChange={(e) => setOldPin(e.target.value)} placeholder="Current PIN" className="w-full bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm" />
                <input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="New PIN" className="w-full bg-black/50 border border-neutral-800 rounded-lg px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <button onClick={doChangePin} disabled={pinBusy} className="flex-1 bg-white text-black py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                    {pinBusy ? 'Changing…' : 'Update PIN'}
                  </button>
                  <button onClick={() => { setChangingPin(false); setPinMsg(''); }} className="px-3 py-2 text-neutral-400 text-sm">Cancel</button>
                </div>
              </div>
            )}
            {pinMsg && <p className="text-xs text-neutral-400 mt-2">{pinMsg}</p>}
          </div>

          <div className="flex gap-2 pt-3 border-t border-neutral-800">
            <button
              onClick={() => { km.lock(); onLocked(); }}
              className="flex-1 flex items-center justify-center gap-2 bg-neutral-800 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-neutral-700 border border-neutral-700"
            >
              <Lock className="w-4 h-4" /> Lock now
            </button>
            <button
              onClick={() => {
                if (confirm('Reset identity? This wipes your keys, User ID, and all conversation history on this device. This cannot be undone.')) {
                  km.wipe();
                  onLocked();
                }
              }}
              className="px-4 py-2.5 text-red-400 hover:text-red-300 border border-red-500/30 rounded-xl text-sm hover:bg-red-500/10"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

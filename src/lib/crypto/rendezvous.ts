/**
 * rendezvous.ts — a typed client wrapper over the ephemeral User-ID Socket.IO
 * events. All payloads are opaque to the server except fingerprints and the public
 * prekey bundle. There is no offline queue: `lookup` returns null and `sendDmInit`
 * surfaces `dm-error{reason:'offline'}` when the peer is not currently connected.
 */

import type { Socket } from 'socket.io-client';
import { PreKeyBundle } from './ratchet';
import { PublicIdentity } from './identity';
import {
  bytesToBase64,
  base64ToBytes,
} from './wire';

/** Wire form of a prekey bundle (byte fields → base64). */
export interface BundleWire {
  signPub: string;
  dhPub: string;
  fingerprint: string;
  signedPreKey: string;
  signedPreKeySig: string;
  oneTimePreKey?: string;
  epoch: number;
}

export const bundleToWire = (b: PreKeyBundle): BundleWire => ({
  signPub: bytesToBase64(b.identity.signPub),
  dhPub: bytesToBase64(b.identity.dhPub),
  fingerprint: b.identity.fingerprint,
  signedPreKey: bytesToBase64(b.signedPreKey),
  signedPreKeySig: bytesToBase64(b.signedPreKeySig),
  oneTimePreKey: b.oneTimePreKey ? bytesToBase64(b.oneTimePreKey) : undefined,
  epoch: b.epoch,
});

export const bundleFromWire = (w: BundleWire): PreKeyBundle => {
  const identity: PublicIdentity = {
    signPub: base64ToBytes(w.signPub),
    dhPub: base64ToBytes(w.dhPub),
    fingerprint: w.fingerprint,
  };
  return {
    identity,
    signedPreKey: base64ToBytes(w.signedPreKey),
    signedPreKeySig: base64ToBytes(w.signedPreKeySig),
    oneTimePreKey: w.oneTimePreKey ? base64ToBytes(w.oneTimePreKey) : undefined,
    epoch: w.epoch,
  };
};

export interface DmInitPayload {
  from: string;
  init: unknown;
  envelope: unknown;
}
export interface DmPayload {
  from: string;
  envelope: unknown;
}

export class Rendezvous {
  constructor(private socket: Socket) {}

  register(fingerprint: string, bundle: BundleWire): void {
    this.socket.emit('id-register', { fingerprint, bundle: JSON.stringify(bundle) });
  }

  unregister(): void {
    this.socket.emit('id-unregister');
  }

  /** Look up a peer's live prekey bundle. Resolves to null if the peer is offline. */
  lookup(fingerprint: string, timeoutMs = 8000): Promise<BundleWire | null> {
    return new Promise((resolve) => {
      const handler = (data: { fingerprint: string; bundle: string | null }) => {
        if (data.fingerprint !== fingerprint) return;
        this.socket.off('id-bundle', handler);
        clearTimeout(timer);
        resolve(data.bundle ? (JSON.parse(data.bundle) as BundleWire) : null);
      };
      const timer = setTimeout(() => {
        this.socket.off('id-bundle', handler);
        resolve(null);
      }, timeoutMs);
      this.socket.on('id-bundle', handler);
      this.socket.emit('id-lookup', { fingerprint });
    });
  }

  sendDmInit(to: string, init: unknown, envelope: unknown): void {
    this.socket.emit('dm-init', { to, init, envelope });
  }

  sendDmRelay(to: string, envelope: unknown): void {
    this.socket.emit('dm-relay', { to, envelope });
  }

  onDmInit(handler: (p: DmInitPayload) => void): () => void {
    this.socket.on('dm-init-receive', handler);
    return () => this.socket.off('dm-init-receive', handler);
  }

  onDmReceive(handler: (p: DmPayload) => void): () => void {
    this.socket.on('dm-receive', handler);
    return () => this.socket.off('dm-receive', handler);
  }

  onDmError(handler: (p: { to: string; reason: string }) => void): () => void {
    this.socket.on('dm-error', handler);
    return () => this.socket.off('dm-error', handler);
  }
}

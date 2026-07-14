/**
 * groupSession.ts — imperative orchestrator for a room's group (sender-keys) crypto.
 *
 * Keeps the React layer thin: the room page feeds it wrapped distributions and
 * envelopes from Socket.IO and gets back plaintext + the authenticated sender
 * identity. Distribution payloads are wrapped under the room key, so the server
 * never sees chain keys.
 */

import { RoomEnvelopeV2 } from './protocol';
import { IdentityKeyPair, PublicIdentity, toPublicIdentity } from './identity';
import {
  SenderKeyState,
  RemoteSenderKeyState,
  createSenderKey,
  makeDistribution,
  senderKeyEncrypt,
  senderKeyDecrypt,
  wrapDistribution,
  unwrapDistribution,
  serializeSenderKey,
  deserializeSenderKey,
} from './senderKeys';

/** Thrown when an envelope arrives before its sender's distribution — buffer & retry. */
export class MissingSenderKeyError extends Error {
  constructor(
    public sid: string,
    public epoch: number,
  ) {
    super(`No sender key for ${sid}@${epoch}`);
  }
}

export class GroupSession {
  private remotes = new Map<string, RemoteSenderKeyState>(); // `${sid}:${epoch}`
  private identities = new Map<string, PublicIdentity>(); // fingerprint -> identity
  private wrapped = '';

  private constructor(
    private readonly roomKeyBytes: Uint8Array,
    private readonly identity: IdentityKeyPair,
    private own: SenderKeyState,
  ) {}

  static async create(
    roomKeyBytes: Uint8Array,
    identity: IdentityKeyPair,
    opts: { epoch?: number; restore?: string } = {},
  ): Promise<GroupSession> {
    const own = opts.restore ? deserializeSenderKey(opts.restore) : createSenderKey(identity, opts.epoch ?? 0);
    const gs = new GroupSession(roomKeyBytes, identity, own);
    gs.identities.set(identity.fingerprint, toPublicIdentity(identity));
    await gs.refreshDistribution();
    return gs;
  }

  private async refreshDistribution(): Promise<void> {
    // The distribution always advertises the epoch's INITIAL chain state (n=0 style),
    // so any member — including a late joiner — can ratchet forward to any message.
    const dist = makeDistribution(this.own, this.identity);
    this.wrapped = await wrapDistribution(this.roomKeyBytes, toPublicIdentity(this.identity), dist);
  }

  get myFingerprint(): string {
    return this.identity.fingerprint;
  }
  get epoch(): number {
    return this.own.epoch;
  }

  /** Wrapped distribution to broadcast/unicast to members. */
  distribution(): string {
    return this.wrapped;
  }

  /** Serialize our own sender-key state for at-rest persistence via keyManager. */
  serializeOwn(): string {
    return serializeSenderKey(this.own);
  }

  /** Adopt a member's wrapped distribution; returns the (TOFU) sender identity. */
  async adopt(wrapped: string): Promise<PublicIdentity> {
    const { identity, remote } = await unwrapDistribution(this.roomKeyBytes, wrapped);
    this.remotes.set(`${remote.fingerprint}:${remote.epoch}`, remote);
    this.identities.set(identity.fingerprint, identity);
    return identity;
  }

  async encrypt(plaintext: Uint8Array): Promise<RoomEnvelopeV2> {
    const { env, state } = await senderKeyEncrypt(this.own, plaintext);
    this.own = state;
    return env;
  }

  hasSenderFor(sid: string, epoch: number): boolean {
    return this.remotes.has(`${sid}:${epoch}`);
  }

  async decrypt(env: RoomEnvelopeV2): Promise<{ plaintext: Uint8Array; identity: PublicIdentity }> {
    const key = `${env.sid}:${env.epoch}`;
    const remote = this.remotes.get(key);
    if (!remote) throw new MissingSenderKeyError(env.sid, env.epoch);
    const { plaintext, state } = await senderKeyDecrypt(remote, env);
    this.remotes.set(key, state);
    return { plaintext, identity: this.identities.get(env.sid)! };
  }

  /** All identities we've learned in this room (for safety-number verification UI). */
  senders(): PublicIdentity[] {
    return Array.from(this.identities.values());
  }

  identityOf(fingerprint: string): PublicIdentity | undefined {
    return this.identities.get(fingerprint);
  }

  /** Bump the epoch and issue a fresh chain key (call on membership change). */
  async rekey(): Promise<string> {
    this.own = createSenderKey(this.identity, this.own.epoch + 1);
    await this.refreshDistribution();
    return this.wrapped;
  }
}

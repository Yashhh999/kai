# Kai Security Model

Kai is a browser-based, ephemeral, end-to-end-encrypted chat app. This document
describes what protects your messages, the exact cryptography used, and — just as
importantly — the limits of what a browser app can promise.

> **Honest headline:** because Kai's server delivers the JavaScript that runs the
> crypto, a malicious or compromised server can, in principle, ship backdoored code.
> No in-browser cryptography can fully prevent this. See [Residual risks](#residual-risks).
> Everything below raises the bar substantially against network and server-side
> **content** compromise, which is the threat most messengers actually face.

## The backbone: the server can route but never decrypt

Every room is entered with a 16-character room code. That code is stretched with
**Argon2id** into a single 32-byte seed, which is split by **HKDF** into three
independent branches:

| Branch | HKDF label | Who sees it | Purpose |
|---|---|---|---|
| `routingId` | `kai/routing-id/v2` | **the server** | the Socket.IO room name |
| `roomKey` | `kai/room-key/v2` | clients only | symmetric root for the room |
| `roomSafetySeed` | `kai/room-safety/v2` | clients only | room safety number |

Because HKDF-Expand is a PRF, publishing `routingId` leaks nothing about its sibling
`roomKey`. The server only ever receives the `routingId`, public-key fingerprints,
opaque ciphertext, and public prekey bundles — never the room code, never a key,
never plaintext. This is enforced and demonstrated by
[`backbone.proof.test.ts`](src/lib/crypto/backbone.proof.test.ts).

> This replaces the previous design, where the raw room code was sent to the server
> as the room id **and** was the sole input to key derivation (with a hardcoded
> static salt) — meaning the server could derive every key. That flaw is fixed.

## Cryptographic primitives

All primitives come from the audited, pure-JS [`@noble`](https://github.com/paulmillr/noble-curves)
libraries plus the browser's WebCrypto `AES-GCM`:

- **Argon2id** (`@noble/hashes`) — memory-hard stretch of low-entropy inputs (room
  code, PIN, invite password). Runs only at join / unlock / redeem, never per message.
- **HKDF-SHA-256** — all domain-separated subkey derivation (fast, per message).
- **X25519** — ECDH for the 1:1 handshake and forward secrecy.
- **Ed25519** — signatures for prekeys, sender keys, and invites.
- **AES-256-GCM** — authenticated encryption of every message, file, and voice frame.
- **Key-committing AEAD** — where multiple keys are in play (sender keys, invites,
  sealed store) a key commitment binds each ciphertext to exactly one key, blocking
  partitioning-oracle / "invisible salamander" attacks.

## Identity

On first run each device generates an **X25519 + Ed25519 identity**. The public
halves fold into a fingerprint that is your **User ID**. Private keys are sealed at
rest under a key derived from your PIN via Argon2id (see [At-rest](#at-rest-protection)).

## Group rooms — sender keys with forward secrecy

Group messages use a Signal-style **sender-keys** scheme:

- Each member holds a per-**epoch** chain key that ratchets forward once per message,
  producing a fresh one-time message key each time (so the AES-GCM IV is a fixed zero
  and can never repeat).
- Chain keys are distributed to members inside a **room-key-wrapped** payload (opaque
  to the server) that also carries the sender's signed identity.
- Every group message carries a per-message **Ed25519 signature** under a per-epoch
  signing subkey bound by the identity. Because all members hold the chain key, this
  is what stops one member from forging another's messages. (Group messages are
  therefore **not deniable** — a deliberate trade for forgery resistance, as in Signal.)
- On membership change the epoch is bumped and fresh chain keys are issued, so
  ex-members can't read new messages and late joiners can't read old ones. For v2
  rooms the server also stops buffering/replaying history.

## 1:1 direct messages — X3DH + Double Ratchet

Direct messages between User IDs use **X3DH** to agree an initial secret and the
**Double Ratchet** for per-message forward secrecy and post-compromise security.
1:1 messages are authenticated by the ratchet's symmetric keys (not signatures), so
they remain **deniable**. Prekeys are published into an ephemeral in-RAM rendezvous;
there is no offline queue, so DMs require both parties online (see
[THREAT-MODEL.md](THREAT-MODEL.md) for the trade-offs).

## Safety numbers

Two users can compare a 60-digit **safety number** (or scan a QR) out-of-band to
detect an active man-in-the-middle who swapped keys at the handshake. Rooms have a
room-level safety number derived from `roomSafetySeed`.

## Files and voice

- Files (direct ≤10MB over Socket.IO **and** large-file WebRTC P2P) are encrypted
  under a per-transfer key derived from the room key. The previous plaintext-JSON P2P
  path is gone.
- Voice uses insertable-stream **AES-256-GCM** E2E with a key derived from the room
  key (not the routingId), a fully random per-frame IV (fixing a prior IV-reuse bug),
  and **fail-closed** transforms that drop a frame rather than emit plaintext audio.
  When insertable streams are unavailable the UI reports transport-only (DTLS-SRTP)
  encryption rather than claiming E2E.

## At-rest protection

Your identity keys and session state are sealed in `localStorage` under
`hkdf(argon2id(PIN))` using committing AEAD. **There is no stored PIN** — unlock
succeeds only if the AEAD + commitment verify, so each wrong guess costs a full
Argon2id evaluation. This replaces the previous plaintext 4-digit PIN.

## Residual risks

- **Code-delivery is the ceiling.** The server serves the app's JavaScript, so a
  compromised server could ship code that exfiltrates keys. Mitigations *reduce* but
  cannot *eliminate* this: subresource integrity on static chunks, reproducible builds
  with published hashes, a strict CSP + Trusted Types, and third-party audit. Only a
  trust root off the server (native app / signed extension) truly closes it.
- **Metadata.** The server learns the social graph, presence, and message timing/sizes.
  There is no sealed-sender or cover traffic.
- **Weak PIN.** A 4-digit PIN is ~10⁴ guesses; Argon2id slows each guess but is not
  forensic-grade. Prefer a longer passphrase.
- **Forward secrecy ≠ local deletion.** FS protects captured network traffic; the
  24h/7d `localStorage` cache still holds plaintext on the device until it expires.

## Reporting

Please open a GitHub issue for security concerns. See [THREAT-MODEL.md](THREAT-MODEL.md)
for the full adversary analysis.

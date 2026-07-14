# Kai Threat Model

This document states what Kai defends against, what it does not, and the deliberate
simplifications made relative to the Signal protocol. Read alongside
[SECURITY.md](SECURITY.md).

## Assets

- Message, file, and voice **plaintext**.
- Identity **private keys** (X25519 + Ed25519).
- The **room key** and room membership / social graph.

## Adversaries and what the design buys

| Adversary | Before this overhaul | After |
|---|---|---|
| **Honest-but-curious server** | Derived **every** key from the room code it received | Sees only `routingId`, fingerprints, opaque ciphertext, public bundles, and timing/sizes → **cannot read content** |
| **Passive network / TLS middlebox** | Same as the server | Same as the server; voice E2E survives TURN relays |
| **Active MITM at handshake** | — | Can swap prekey bundles, but **safety numbers / QR** let users detect it out-of-band |
| **Malicious room member** | Could forge other members' messages | Per-message **Ed25519 signatures** stop forgery; **epoch rekey** cuts off ex-members |
| **Device / local attacker** | Read the plaintext PIN and message cache | Identity + sessions sealed under **Argon2id(PIN)**; no plaintext PIN; caches keyed by routingId |
| **Replay / reorder** | — | Ratchet + sender-key counters reject duplicates; bounded skipped-key maps resist memory-exhaustion DoS |
| **Downgrade to legacy format** | — | Version + kind bound into AEAD associated data; highest-seen version pinned per conversation |

## What Kai does NOT defend against

- **A malicious or compromised server shipping backdoored client code.** This is the
  fundamental ceiling of any web-delivered crypto app. Mitigate with SRI, reproducible
  published builds, strict CSP + Trusted Types, and audits — or move the trust root to
  a native/extension client. Do not rely on Kai against an adversary who controls the
  code you are served.
- **Metadata analysis.** The server observes who talks to whom, when, and roughly how
  much. No sealed sender, no cover traffic (out of scope for the MVP).
- **A determined forensic attacker with your unlocked device**, or brute force of a
  weak (e.g. 4-digit) PIN given enough time and the sealed blob.
- **Endpoint compromise** (malware, a hostile browser extension) that reads memory or
  keystrokes.

## Deliberate simplifications vs Signal (and why)

- **No durable prekey pool / offline queue.** Prekeys live only in an ephemeral in-RAM
  rendezvous; DMs need both parties online. This preserves the zero-durable-storage
  philosophy at the cost of offline delivery.
- **No sealed sender.** The server sees fingerprints to route DMs. MVP scope.
- **Group deniability is sacrificed** for member-forgery resistance (per-message
  signatures). 1:1 DMs remain deniable.
- **PIN-sealed store** instead of a registration lock / secure-enclave key storage —
  the strongest option available to a pure browser app.
- **Single-use / max-use invite counters survive only server uptime** (RAM only),
  consistent with the ephemeral, zero-durable-storage promise. Confidentiality is
  never weakened by a counter reset — the room key is never on the server.
- **Room-code group model retained** alongside User-ID DMs for quick, account-free use.

## Trust bootstrapping

- **Rooms:** anyone with the room code (or a valid invite) is a trusted member. Members
  learn each other's identities on first use (TOFU); safety numbers upgrade this to
  verified.
- **DMs:** identities are exchanged via the rendezvous; verify with safety numbers to
  defeat an active MITM.

## Forward secrecy & post-compromise security

- **1:1:** full Double Ratchet — a compromised message key does not expose past or
  future messages beyond a bounded window; new DH ratchet steps heal after compromise.
- **Groups:** per-epoch chain keys + rekey on membership change give forward secrecy
  across sessions and membership boundaries (not per-message PCS within an epoch).

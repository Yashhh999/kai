# Kai - Encrypted Chat

Fast, secure chat rooms with browser storage and end-to-end encryption.

## Features

- **E2E Encryption** - AES-GCM 256-bit encryption
- **Browser Storage** - No database, all local
- **Flexible Retention** - 24 hours or 7 weeks
- **Message Editing** - Edit with history tracking
- **Message Deletion** - Delete with "msg deleted" text
- **File Sharing** - Images, videos, docs with auto-compression
- **P2P Transfer** - WebRTC for files >10MB
- **Typing Indicators** - See who's typing
- **Online Status** - Real-time presence
- **Username Support** - Customizable display names
- **Room Codes** - Secure 16-digit codes

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Usage

1. Set your username
2. Create or join a room
3. Share the room code
4. Chat securely

## Features Detail

### File Sharing
- Images, videos, PDFs, documents, archives
- Automatic image compression
- Thumbnail generation
- Direct send <10MB (encrypted Socket.IO)
- P2P transfer >10MB (WebRTC)

### Message Editing
- Edit your messages anytime
- Both users can view original content
- Timestamp shows edit history

### Message Deletion
- Delete your own messages
- Shows "Message deleted" to all users
- Removes content from storage

### Storage Options
- **24H** - Default, messages expire in 24 hours
- **7D** - Extended mode, messages expire in 7 days
## Tech

- Next.js 16
- Socket.IO
- simple-peer (WebRTC)
- browser-image-compression
- Web Crypto API
- TypeScript
- Tailwind CSS
### Online Status
- Active user list
- Last seen tracking
- 30-second heartbeat

## Tech

- Next.js 16
- Socket.IO  
- Web Crypto API
- TypeScript
- Tailwind CSS

## Security

Kai aims for Signal-grade security for ephemeral/group use while keeping a
zero-durable-storage server. Highlights:

- **Server can route but never decrypt** — the room code derives a one-way server
  `routingId` and a client-only room key on **separate HKDF branches**, so the raw
  code and keys never reach the server.
- **Argon2id + HKDF** key hierarchy (replaces the old static-salt PBKDF2).
- **Cryptographic identities** (X25519 + Ed25519); your User ID is your key fingerprint.
- **Forward secrecy** — Double Ratchet for 1:1 DMs, sender-keys with epoch rekey for rooms.
- **Safety numbers / QR** for out-of-band MITM detection.
- **Secure invites** (fragment-based, never sent to the server; expiry / max-uses /
  one-time / password / max-participants).
- **AES-256-GCM** for messages, files (direct **and** P2P), and voice; identity keys
  sealed at rest under an Argon2id(PIN) key (no plaintext PIN).

See **[SECURITY.md](SECURITY.md)** and **[THREAT-MODEL.md](THREAT-MODEL.md)** — including
the honest limits of any browser-delivered crypto app.

## License

MIT
# kai

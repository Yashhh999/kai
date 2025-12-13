# Rooms - Encrypted Chat

Fast, secure chat rooms with browser storage and end-to-end encryption.

## Features

- **E2E Encryption** - AES-GCM 256-bit encryption
- **Browser Storage** - No database, all local
- **Flexible Retention** - 24 hours or 7 weeks
- **Message Editing** - Edit with history tracking
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

### Message Editing
- Edit your messages anytime
- Both users can view original content
- Timestamp shows edit history

### Storage Options
- **24H** - Default, messages expire in 24 hours
- **7W** - Extended mode, keeps chats for 7 weeks

### Typing Indicators
- Real-time typing status
- 2-second timeout
- Shows username while typing

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

- Client-side encryption
- PBKDF2 key derivation
- Zero server storage
- Cryptographic random codes

## License

MIT
# kai

# Features Overview

## Core Functionality

### User Management
- **Customizable Username** - Set your display name in settings
- **Persistent Preferences** - Username and settings saved locally
- **Quick Setup** - One-time username configuration

### Room Features
- **Random Room Codes** - 16-digit cryptographic codes
- **Easy Sharing** - Click to copy formatted codes
- **Recent Rooms** - Quick access to last 3 rooms
- **Room Persistence** - Messages saved per room

### Messaging
- **Real-Time** - Instant message delivery via WebSocket
- **E2E Encryption** - All messages encrypted client-side
- **Message Editing** - Edit sent messages anytime
- **Edit History** - View original message content
- **Sender Names** - Display username with each message

### Presence
- **Online Status** - See who's currently active
- **Typing Indicators** - Real-time typing notifications
- **User List** - Active participants shown in header
- **Heartbeat System** - 30s ping to maintain presence

### Storage Options
- **24-Hour Mode** - Default retention period
- **7-Week Mode** - Extended storage for long-term chats
- **Per-Room Setting** - Toggle retention per conversation
- **Auto-Cleanup** - Expired messages automatically removed

## Technical Features

### Security
- AES-GCM 256-bit encryption
- PBKDF2 key derivation (100k iterations)
- crypto.getRandomValues() for codes
- No server-side message storage
- Client-side encryption/decryption

### Performance
- Optimized React hooks (useCallback, useMemo)
- Efficient Socket.IO event handling
- Minimal re-renders
- Local storage caching
- Fast message sending (<50ms)

### UX Enhancements
- Smooth scrolling to new messages
- Auto-focus on edit inputs
- Keyboard shortcuts (Enter to save, Esc to cancel)
- Responsive design
- Copy feedback
- Loading states
- Error handling

## Usage

### First Time
1. Open app → prompted for username
2. Set username and retention preference
3. Create or join a room

### Creating Room
1. Click "Create Room"
2. Room code generated automatically
3. Click code to copy
4. Share with others

### Joining Room
1. Paste room code
2. Click "Join"
3. Start chatting

### Editing Messages
1. Click "Edit" on your message
2. Modify text
3. Press Enter or click Save
4. Original visible via "Show original"

### Settings
- Click "Settings" on home page
- Change username anytime
- Toggle 7-week retention
- Changes apply to new rooms

## Keyboard Shortcuts

- `Enter` - Send message / Save edit
- `Escape` - Cancel edit
- `Tab` - Navigate inputs

## Browser Support

- Chrome 88+
- Firefox 75+
- Safari 14+
- Edge 88+

Requires: localStorage, WebSocket, Web Crypto API

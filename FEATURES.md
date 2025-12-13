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
- **Message Deletion** - Delete your own messages
- **Sender Names** - Display username with each message

### File Sharing
- **Multiple File Types** - Images, videos, documents, archives, code files
- **Automatic Compression** - Images optimized to reduce size
- **Thumbnail Generation** - Preview for image files
- **Direct Transfer** - Files <10MB sent via encrypted Socket.IO
- **P2P Transfer** - Files >10MB sent via WebRTC peer-to-peer
- **Download Support** - One-click download for all files

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
- WebRTC encrypted data channels for P2P
- Files encrypted before transmission

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
### Editing Messages
1. Click "Edit" on your message
2. Modify text
3. Press Enter or click Save
4. Original visible via "Show original"

### Deleting Messages
1. Click "Delete" on your message
2. Confirm deletion
3. Message replaced with "Message deleted"

### Sending Files
1. Click file button (📎) in chat input
2. Select file or drag & drop
3. Files <10MB sent directly (encrypted)
4. Files >10MB use P2P transfer
5. View progress bar for uploads
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

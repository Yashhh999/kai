# File Sharing & Message Deletion Guide

## File Sharing

The chat supports sending files with automatic optimization and P2P transfer for large files.

### Direct File Transfer (<10MB)

Files under 10MB are sent directly through the encrypted Socket.IO connection:

1. Click the file upload button (📎) in the chat input
2. Select a file or drag & drop
3. File is automatically encrypted and sent to all room participants
4. Images are automatically compressed and thumbnails are generated

### P2P Transfer (>10MB)

Files over 10MB use WebRTC peer-to-peer transfer to avoid server limitations:

1. Click the file upload button
2. If file is >10MB, you'll see a confirmation dialog
3. Direct WebRTC connections are established with all room participants
4. File is sent directly between peers (not through server)
5. Upload progress is shown at the bottom

### Supported File Types

- **Images**: .jpg, .jpeg, .png, .gif, .webp, .svg
  - Automatically compressed to optimize size
  - Thumbnail preview generated
  - Click to view full size
  
- **Videos**: .mp4, .webm, .ogg, .mov
  - Downloadable file with video icon
  
- **Documents**: .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx
  - Downloadable with document icon
  
- **Archives**: .zip, .rar, .7z, .tar, .gz
  - Downloadable with archive icon
  
- **Code**: .js, .ts, .py, .java, .cpp, .html, .css
  - Downloadable with code icon

### File Display

Each file message shows:
- File icon/thumbnail
- File name (truncated if long)
- File size (human-readable format)
- Download button
- Timestamp

## Message Deletion

Users can delete their own messages:

1. Hover over your own message
2. Click the "Delete" button
3. Confirm deletion in the dialog
4. Message is replaced with "Message deleted" text for all users

### Deletion Behavior

- Only sender can delete their own messages
- Deleted messages show "Message deleted" in gray italics
- Deletion is synchronized across all room participants
- Original content is removed from browser storage
- File attachments are removed on deletion

### Edit vs Delete

- **Text messages**: Can be edited or deleted
- **File messages**: Can only be deleted (not edited)
- **Deleted messages**: Cannot be restored

## Technical Details

### Encryption

- All files <10MB are encrypted with AES-GCM 256-bit before transmission
- P2P transfers (>10MB) use encrypted WebRTC data channels
- File metadata (name, size, type) is included in encrypted payload

### Storage

- Files are stored as Base64 in browser localStorage
- Images include compressed thumbnail
- 10MB limit keeps localStorage under 50MB quota
- Extended retention (7 weeks) applies to file messages too

### Performance

- Image compression reduces size by 50-80% typically
- Thumbnails are 300x300px max
- P2P transfers don't consume server bandwidth
- WebRTC uses UDP for optimal speed

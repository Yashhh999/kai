'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import ChatMessages from '@/components/ChatMessages';
import ChatInput from '@/components/ChatInput';
import RoomHeader from '@/components/RoomHeader';
import { deriveKey, encryptMessage, decryptMessage, EncryptedMessage } from '@/lib/encryption';
import { saveRoomData, loadRoomData, Message, getUserPreferences, saveUserPreferences } from '@/lib/storage';

interface RoomUser {
  id: string;
  name: string;
  lastSeen: number;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.roomCode as string;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [username, setUsername] = useState('');
  const [extendedRetention, setExtendedRetention] = useState(false);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!roomCode) {
      router.push('/');
      return;
    }

    const prefs = getUserPreferences();
    if (!prefs.username) {
      router.push('/');
      return;
    }

    setUsername(prefs.username);
    setExtendedRetention(prefs.extendedRetention);

    const existingData = loadRoomData(roomCode);
    if (existingData) {
      setMessages(existingData.messages);
      setExtendedRetention(existingData.extendedRetention);
    }

    deriveKey(roomCode).then(setEncryptionKey);

    const socketInstance = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
    });

    socketInstance.on('connect', () => {
      setIsConnected(true);
      socketInstance.emit('join-room', { roomId: roomCode, username: prefs.username });
    });

    socketInstance.on('disconnect', () => setIsConnected(false));

    socketInstance.on('users-update', (usersList: RoomUser[]) => {
      setUsers(usersList);
    });

    socketInstance.on('user-typing', ({ userId, username: typingUsername, isTyping }: any) => {
      setTypingUsers(prev => {
        const next = new Set(prev);
        if (isTyping) {
          next.add(typingUsername);
        } else {
          next.delete(typingUsername);
        }
        return next;
      });
    });

    setSocket(socketInstance);

    const heartbeat = setInterval(() => {
      socketInstance.emit('heartbeat', { roomId: roomCode });
    }, 30000);

    return () => {
      clearInterval(heartbeat);
      socketInstance.emit('leave-room', roomCode);
      socketInstance.disconnect();
    };
  }, [roomCode, router]);

  useEffect(() => {
    if (!encryptionKey || !socket) return;

    const handleReceiveMessage = async ({ encryptedMessage, senderId, senderName, timestamp }: any) => {
      try {
        const decrypted = await decryptMessage(encryptedMessage, encryptionKey);
        const newMessage: Message = {
          id: `${senderId}-${timestamp}`,
          content: decrypted,
          senderId,
          senderName,
          timestamp,
          isSent: false,
        };

        setMessages(prev => {
          const updated = [...prev, newMessage];
          saveRoomData(roomCode, updated, extendedRetention);
          return updated;
        });
      } catch (error) {
        console.error('Decryption failed:', error);
      }
    };

    const handleMessageEdited = async ({ messageId, encryptedMessage, originalEncrypted, editedAt }: any) => {
      try {
        const decrypted = await decryptMessage(encryptedMessage, encryptionKey);
        const original = originalEncrypted ? await decryptMessage(originalEncrypted, encryptionKey) : undefined;

        setMessages(prev => {
          const updated = prev.map(msg => 
            msg.id === messageId 
              ? { ...msg, content: decrypted, editedAt, originalContent: original || msg.content }
              : msg
          );
          saveRoomData(roomCode, updated, extendedRetention);
          return updated;
        });
      } catch (error) {
        console.error('Edit decryption failed:', error);
      }
    };

    socket.on('receive-message', handleReceiveMessage);
    socket.on('message-edited', handleMessageEdited);

    return () => {
      socket.off('receive-message', handleReceiveMessage);
      socket.off('message-edited', handleMessageEdited);
    };
  }, [encryptionKey, socket, roomCode, extendedRetention]);

  const handleSendMessage = useCallback(async (content: string) => {
    if (!socket || !encryptionKey || !isConnected) return;

    try {
      const encrypted = await encryptMessage(content, encryptionKey);
      const timestamp = Date.now();

      socket.emit('send-message', {
        roomId: roomCode,
        encryptedMessage: encrypted,
        username,
      });

      const newMessage: Message = {
        id: `${socket.id}-${timestamp}`,
        content,
        senderId: socket.id!,
        senderName: username,
        timestamp,
        isSent: true,
      };

      setMessages(prev => {
        const updated = [...prev, newMessage];
        saveRoomData(roomCode, updated, extendedRetention);
        return updated;
      });
    } catch (error) {
      console.error('Send failed:', error);
    }
  }, [socket, encryptionKey, isConnected, roomCode, username, extendedRetention]);

  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    if (!socket || !encryptionKey) return;

    try {
      const message = messages.find(m => m.id === messageId);
      if (!message) return;

      const encrypted = await encryptMessage(newContent, encryptionKey);
      const originalEncrypted = await encryptMessage(message.content, encryptionKey);

      socket.emit('edit-message', {
        roomId: roomCode,
        messageId,
        encryptedMessage: encrypted,
        originalEncrypted,
      });

      setMessages(prev => {
        const updated = prev.map(msg =>
          msg.id === messageId
            ? { ...msg, content: newContent, editedAt: Date.now(), originalContent: message.content }
            : msg
        );
        saveRoomData(roomCode, updated, extendedRetention);
        return updated;
      });
      
      setEditingMessage(null);
    } catch (error) {
      console.error('Edit failed:', error);
    }
  }, [socket, encryptionKey, messages, roomCode, extendedRetention]);

  const handleTyping = useCallback((isTyping: boolean) => {
    if (!socket) return;
    if (isTyping) {
      socket.emit('typing-start', { roomId: roomCode, username });
    } else {
      socket.emit('typing-stop', roomCode);
    }
  }, [socket, roomCode, username]);

  const toggleRetention = useCallback(() => {
    const newRetention = !extendedRetention;
    setExtendedRetention(newRetention);
    saveRoomData(roomCode, messages, newRetention);
    
    const prefs = getUserPreferences();
    saveUserPreferences({ ...prefs, extendedRetention: newRetention });
  }, [extendedRetention, roomCode, messages]);

  const onlineUsers = useMemo(() => {
    const now = Date.now();
    return users.filter(u => now - u.lastSeen < 60000);
  }, [users]);

  return (
    <div className="flex flex-col h-screen bg-black">
      <RoomHeader 
        roomCode={roomCode} 
        users={onlineUsers}
        extendedRetention={extendedRetention}
        onToggleRetention={toggleRetention}
      />
      <ChatMessages 
        messages={messages} 
        currentUserId={socket?.id || ''} 
        onEditMessage={handleEditMessage}
        editingMessage={editingMessage}
        setEditingMessage={setEditingMessage}
      />
      {typingUsers.size > 0 && (
        <div className="px-6 py-2 text-sm text-gray-500">
          {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
        </div>
      )}
      <ChatInput 
        onSendMessage={handleSendMessage} 
        onTyping={handleTyping}
        disabled={!isConnected} 
      />
    </div>
  );
}

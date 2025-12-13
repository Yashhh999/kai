'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import Peer from 'simple-peer';
import ChatMessages from '@/components/ChatMessages';
import ChatInput from '@/components/ChatInput';
import RoomHeader from '@/components/RoomHeader';
import { deriveKey, encryptMessage, decryptMessage } from '@/lib/encryption';
import { saveRoomData, loadRoomData, Message, getUserPreferences, saveUserPreferences } from '@/lib/storage';
import { prepareFile, isFileTooLarge } from '@/lib/fileUtils';

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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [transferMode, setTransferMode] = useState<'p2p' | 'direct' | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);
  const peersRef = useRef<Map<string, Peer.Instance>>(new Map());

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

    socketInstance.on('message-history', async (history: any[]) => {
      if (!encryptionKey) {
        const key = await deriveKey(roomCode);
        const decryptedMessages = await Promise.all(
          history.map(async (msg) => {
            try {
              const decrypted = await decryptMessage(msg.encryptedMessage, key);
              return {
                id: `${msg.senderId}-${msg.timestamp}`,
                content: decrypted,
                senderId: msg.senderId,
                senderName: msg.senderName,
                timestamp: msg.timestamp,
                isSent: false,
              };
            } catch (error) {
              return null;
            }
          })
        );
        const validMessages = decryptedMessages.filter(m => m !== null) as Message[];
        setMessages(prev => [...validMessages, ...prev]);
      }
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

    const handleMessageDeleted = ({ messageId }: any) => {
      setMessages(prev => {
        const updated = prev.map(msg =>
          msg.id === messageId
            ? { ...msg, type: 'deleted' as const, content: '', file: undefined }
            : msg
        );
        saveRoomData(roomCode, updated, extendedRetention);
        return updated;
      });
    };

    const handleFileReceived = async ({ encryptedFile, senderId, senderName, timestamp }: any) => {
      try {
        setIsReceiving(true);
        setDownloadProgress(30);
        
        const decrypted = await decryptMessage(encryptedFile, encryptionKey);
        setDownloadProgress(60);
        
        const fileData = JSON.parse(decrypted);
        setDownloadProgress(90);
        
        const newMessage: Message = {
          id: `${senderId}-${timestamp}`,
          content: '',
          type: 'file',
          file: fileData,
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
        
        setDownloadProgress(100);
        setTimeout(() => {
          setDownloadProgress(0);
          setIsReceiving(false);
        }, 1000);
      } catch (error) {
        console.error('File receive failed:', error);
        setDownloadProgress(0);
        setIsReceiving(false);
      }
    };

    const handleP2PRequest = ({ from }: any) => {
      const peer = new Peer({ 
        initiator: false, 
        trickle: false,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
      
      setIsReceiving(true);
      setDownloadProgress(10);
      
      const timeout = setTimeout(() => {
        console.error('P2P receive timeout');
        setDownloadProgress(0);
        setIsReceiving(false);
        peer.destroy();
      }, 15000);
      
      peer.on('signal', (signal: any) => {
        setDownloadProgress(30);
        socket.emit('p2p-signal', { to: from, roomId: roomCode, signal });
        setDownloadProgress(40);
      });

      peer.on('connect', () => {
        clearTimeout(timeout);
        setDownloadProgress(60);
      });

      peer.on('data', async (data: any) => {
        try {
          setDownloadProgress(75);
          
          const fileData = JSON.parse(data.toString());
          setDownloadProgress(90);
          
          const newMessage: Message = {
            id: `${from}-${Date.now()}`,
            content: '',
            type: 'file',
            file: fileData,
            senderId: from,
            senderName: users.find((u: RoomUser) => u.id === from)?.name || 'Unknown',
            timestamp: Date.now(),
            isSent: false,
          };

          setMessages(prev => {
            const updated = [...prev, newMessage];
            saveRoomData(roomCode, updated, extendedRetention);
            return updated;
          });
          
          setDownloadProgress(100);
          setTimeout(() => {
            setDownloadProgress(0);
            setIsReceiving(false);
          }, 1000);
        } catch (error) {
          console.error('P2P file receive error:', error);
          setDownloadProgress(0);
          setIsReceiving(false);
        }
      });

      peer.on('error', (err) => {
        clearTimeout(timeout);
        console.error('P2P receive error:', err);
        setDownloadProgress(0);
        setIsReceiving(false);
      });

      peersRef.current.set(from, peer);
    };

    const handleP2PSignal = ({ from, signal }: any) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        try {
          peer.signal(signal);
          if (transferMode === 'p2p') {
            setUploadProgress(prev => Math.min(prev + 5, 55));
          }
          if (isReceiving) {
            setDownloadProgress(prev => Math.min(prev + 5, 55));
          }
        } catch (err) {
          console.error('Signal error:', err);
        }
      }
    };

    socket.on('receive-message', handleReceiveMessage);
    socket.on('message-edited', handleMessageEdited);
    socket.on('message-deleted', handleMessageDeleted);
    socket.on('receive-file', handleFileReceived);
    socket.on('p2p-request', handleP2PRequest);
    socket.on('p2p-signal', handleP2PSignal);

    return () => {
      socket.off('receive-message', handleReceiveMessage);
      socket.off('message-edited', handleMessageEdited);
      socket.off('message-deleted', handleMessageDeleted);
      socket.off('receive-file', handleFileReceived);
      socket.off('p2p-request', handleP2PRequest);
      socket.off('p2p-signal', handleP2PSignal);
      
      peersRef.current.forEach(peer => peer.destroy());
      peersRef.current.clear();
    };
  }, [encryptionKey, socket, roomCode, extendedRetention, users]);

  const handleSendMessage = useCallback(async (content: string, attachment?: { file: File; useP2P: boolean }) => {
    if (!socket || !encryptionKey || !isConnected) return;
    if (!content.trim() && !attachment) return;

    try {
      const timestamp = Date.now();

      if (attachment) {
        const prepared = await prepareFile(attachment.file);

        if (attachment.useP2P) {
          setTransferMode('p2p');
          setUploadProgress(10);
          const targetUsers = users.filter((u: RoomUser) => u.id !== socket.id);
          if (targetUsers.length === 0) {
            alert('No other users to send file to');
            setTransferMode(null);
            setUploadProgress(0);
            return;
          }

          for (const user of targetUsers) {
            const peer = new Peer({ 
              initiator: true, 
              trickle: false,
              config: {
                iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:global.stun.twilio.com:3478' }
                ]
              }
            });
            
            const timeout = setTimeout(() => {
              console.error('P2P connection timeout');
              setUploadProgress(0);
              setTransferMode(null);
              peer.destroy();
            }, 15000);

            peer.on('signal', (signal: any) => {
              setUploadProgress(30);
              socket.emit('p2p-signal', { to: user.id, roomId: roomCode, signal });
              setUploadProgress(40);
            });

            peer.on('connect', () => {
              clearTimeout(timeout);
              setUploadProgress(60);
              setTimeout(() => {
                const dataStr = JSON.stringify(prepared);
                setUploadProgress(80);
                peer.send(dataStr);
                setUploadProgress(95);
                setTimeout(() => {
                  setUploadProgress(100);
                  setTimeout(() => {
                    setUploadProgress(0);
                    setTransferMode(null);
                  }, 1000);
                }, 200);
              }, 100);
            });

            peer.on('error', (err) => {
              clearTimeout(timeout);
              console.error('P2P error:', err);
              setUploadProgress(0);
              setTransferMode(null);
            });

            peersRef.current.set(user.id, peer);
            socket.emit('p2p-request', { to: user.id, roomId: roomCode });
          }
        } else {
          setTransferMode('direct');
          const encrypted = await encryptMessage(JSON.stringify(prepared), encryptionKey);
          socket.emit('send-file', {
            roomId: roomCode,
            encryptedFile: encrypted,
            username,
          });
          setTimeout(() => setTransferMode(null), 1000);
        }

        const newMessage: Message = {
          id: `${socket.id}-${timestamp}`,
          content: content || '',
          type: 'file',
          file: prepared,
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
      } else {
        const encrypted = await encryptMessage(content, encryptionKey);

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
      }
    } catch (error) {
      console.error('Send failed:', error);
    }
  }, [socket, encryptionKey, isConnected, roomCode, username, extendedRetention, users]);

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

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!socket) return;

    socket.emit('delete-message', { roomId: roomCode, messageId });

    setMessages(prev => {
      const updated = prev.map(msg =>
        msg.id === messageId
          ? { ...msg, type: 'deleted' as const, content: '', file: undefined }
          : msg
      );
      saveRoomData(roomCode, updated, extendedRetention);
      return updated;
    });
  }, [socket, roomCode, extendedRetention]);

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
    return users.filter((u: RoomUser) => now - u.lastSeen < 60000);
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
        onDeleteMessage={handleDeleteMessage}
        editingMessage={editingMessage}
        setEditingMessage={setEditingMessage}
      />
      {typingUsers.size > 0 && (
        <div className="px-6 py-2 text-sm text-neutral-500">
          {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
        </div>
      )}
      {(uploadProgress > 0 || downloadProgress > 0 || transferMode || isReceiving) && (
        <div className="px-6 py-2 space-y-2">
          {transferMode && (
            <div className="flex items-center gap-2 text-sm">
              {transferMode === 'p2p' ? (
                <>
                  <span className="text-blue-400">⚡</span>
                  <span className="text-neutral-300">Sending via P2P... {uploadProgress}%</span>
                </>
              ) : (
                <>
                  <span className="text-green-400">🔒</span>
                  <span className="text-neutral-300">Sending encrypted... {uploadProgress}%</span>
                </>
              )}
            </div>
          )}
          {isReceiving && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-blue-400">📥</span>
              <span className="text-neutral-300">Receiving file... {downloadProgress}%</span>
            </div>
          )}
          {uploadProgress > 0 && (
            <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
          {downloadProgress > 0 && (
            <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          )}
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

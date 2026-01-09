'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import Peer from 'simple-peer';
import ChatMessages from '@/components/ChatMessages';
import ChatInput from '@/components/ChatInput';
import RoomHeader from '@/components/RoomHeader';
import VoiceChannel, { VoiceChannelRef } from '@/components/VoiceChannel';
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
  const [hasLoadedFromStorage, setHasLoadedFromStorage] = useState(false);
  const [isInVoice, setIsInVoice] = useState(false);
  const [voiceParticipantCount, setVoiceParticipantCount] = useState(0);
  const peersRef = useRef<Map<string, Peer.Instance>>(new Map());
  const voiceChannelRef = useRef<VoiceChannelRef>(null);

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
      setHasLoadedFromStorage(true);
    }

    deriveKey(roomCode).then(setEncryptionKey);

    const getSocketUrl = () => {
      if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL;
      }
      if (typeof window !== 'undefined') {
        return window.location.origin;
      }
      return 'http://localhost:3000';
    };

    const socketInstance = io(getSocketUrl(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
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
      if (hasLoadedFromStorage) {
        return;
      }
      if (!encryptionKey) {
        const key = await deriveKey(roomCode);
        const decryptedMessages = await Promise.all(
          history.map(async (msg) => {
            try {
              const decrypted = await decryptMessage(msg.encryptedMessage, key);
              return {
                id: `${msg.senderId}-${msg.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
                content: decrypted,
                senderId: msg.senderId,
                senderName: msg.senderName,
                timestamp: msg.timestamp,
                isSent: false,
                selfDestruct: msg.selfDestruct,
                timerStartedAt: msg.timerStartedAt,
              };
            } catch (error) {
              return null;
            }
          })
        );
        const validMessages = decryptedMessages.filter(m => m !== null) as Message[];
        setMessages(prev => {
          if (prev.length > 0) return prev;
          return validMessages;
        });
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

    const handleReceiveMessage = async ({ encryptedMessage, senderId, senderName, timestamp, selfDestruct, timerStartedAt }: any) => {
      try {
        const decrypted = await decryptMessage(encryptedMessage, encryptionKey);
        const newMessage: Message = {
          id: `${senderId}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
          content: decrypted,
          senderId,
          senderName,
          timestamp,
          isSent: false,
          selfDestruct,
          timerStartedAt,
        };

        setMessages(prev => {
          const isDuplicate = prev.some(msg => 
            msg.senderId === senderId && msg.timestamp === timestamp
          );
          if (isDuplicate) return prev;
          
          const updated = [...prev, newMessage];
          saveRoomData(roomCode, updated, extendedRetention);
          return updated;
        });
      } catch (error) {
        console.error('Decryption failed:', error);
      }
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
          id: `${senderId}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
          content: '',
          type: 'file',
          file: {
            name: fileData.name,
            size: fileData.size,
            type: fileData.type,
            data: fileData.data,
            thumbnail: fileData.thumbnail,
          },
          senderId,
          senderName,
          timestamp,
          isSent: false,
          viewOnce: fileData.viewOnce,
          viewedBy: [],
          selfDestruct: fileData.selfDestruct,
          downloadable: fileData.downloadable,
          timerStartedAt: (fileData.selfDestruct && !fileData.viewOnce) ? Date.now() : undefined,
        };

        setMessages(prev => {
          const isDuplicate = prev.some(msg => 
            msg.senderId === senderId && msg.timestamp === timestamp
          );
          if (isDuplicate) return prev;
          
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
        trickle: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        },
        channelConfig: {},
        offerOptions: {},
        answerOptions: {},
        sdpTransform: (sdp: string) => sdp,
        streams: []
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
            id: `${from}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            content: '',
            type: 'file',
            file: {
              name: fileData.name,
              size: fileData.size,
              type: fileData.type,
              data: fileData.data,
              thumbnail: fileData.thumbnail,
            },
            senderId: from,
            senderName: users.find((u: RoomUser) => u.id === from)?.name || 'Unknown',
            timestamp: Date.now(),
            isSent: false,
            viewOnce: fileData.viewOnce,
            viewedBy: [],
            selfDestruct: fileData.selfDestruct,
            downloadable: fileData.downloadable,
            timerStartedAt: (fileData.selfDestruct && !fileData.viewOnce) ? Date.now() : undefined,
          };

          setMessages(prev => {
            const messageExists = prev.some(m => m.id === newMessage.id);
            if (messageExists) return prev;
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
    socket.on('receive-file', handleFileReceived);
    socket.on('p2p-request', handleP2PRequest);
    socket.on('p2p-signal', handleP2PSignal);

    return () => {
      socket.off('receive-message', handleReceiveMessage);
      socket.off('receive-file', handleFileReceived);
      socket.off('p2p-request', handleP2PRequest);
      socket.off('p2p-signal', handleP2PSignal);
      
      peersRef.current.forEach(peer => peer.destroy());
      peersRef.current.clear();
    };
  }, [encryptionKey, socket, roomCode, extendedRetention, users]);

  const handleSendMessage = useCallback(async (content: string, options?: { selfDestruct?: number; attachment?: { file: File; useP2P: boolean; viewOnce?: boolean; selfDestruct?: number; downloadable?: boolean } }) => {
    if (!socket || !encryptionKey || !isConnected) return;
    const attachment = options?.attachment;
    const messageSelfDestruct = options?.selfDestruct;
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
              trickle: true,
              config: {
                iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:global.stun.twilio.com:3478' }
                ]
              },
              channelConfig: {},
              offerOptions: {},
              answerOptions: {},
              sdpTransform: (sdp: string) => sdp,
              streams: []
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
                const dataWithOptions = {
                  ...prepared,
                  viewOnce: attachment.viewOnce,
                  selfDestruct: attachment.selfDestruct,
                  downloadable: attachment.downloadable,
                };
                const dataStr = JSON.stringify(dataWithOptions);
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
          const fileDataWithOptions = {
            ...prepared,
            viewOnce: attachment.viewOnce,
            selfDestruct: attachment.selfDestruct,
            downloadable: attachment.downloadable,
          };
          const encrypted = await encryptMessage(JSON.stringify(fileDataWithOptions), encryptionKey);
          socket.emit('send-file', {
            roomId: roomCode,
            encryptedFile: encrypted,
            username,
          });
          setTimeout(() => setTransferMode(null), 1000);
        }

        const newMessage: Message = {
          id: `${socket.id}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
          content: content || '',
          type: 'file',
          file: prepared,
          senderId: socket.id!,
          senderName: username,
          timestamp,
          isSent: true,
          viewOnce: attachment.viewOnce,
          viewedBy: [],
          selfDestruct: attachment.selfDestruct,
          downloadable: attachment.downloadable,
          timerStartedAt: (attachment.selfDestruct && !attachment.viewOnce) ? Date.now() : undefined,
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
          selfDestruct: messageSelfDestruct,
          timerStartedAt: messageSelfDestruct ? Date.now() : undefined,
        });

        const newMessage: Message = {
          id: `${socket.id}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
          content,
          senderId: socket.id!,
          senderName: username,
          timestamp,
          isSent: true,
          selfDestruct: messageSelfDestruct,
          timerStartedAt: messageSelfDestruct ? Date.now() : undefined,
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

  const updateMessageTimer = useCallback((messageId: string, timerStartedAt: number) => {
    setMessages(prev => {
      const updated = prev.map(msg =>
        msg.id === messageId
          ? { ...msg, timerStartedAt }
          : msg
      );
      saveRoomData(roomCode, updated, extendedRetention);
      return updated;
    });
  }, [roomCode, extendedRetention]);

  const updateMessageViewedBy = useCallback((messageId: string, userId: string) => {
    setMessages(prev => {
      const updated = prev.map(msg => {
        if (msg.id === messageId) {
          const viewedBy = msg.viewedBy || [];
          if (!viewedBy.includes(userId)) {
            return { ...msg, viewedBy: [...viewedBy, userId] };
          }
        }
        return msg;
      });
      saveRoomData(roomCode, updated, extendedRetention);
      return updated;
    });
  }, [roomCode, extendedRetention]);

  const handleTyping = useCallback((isTyping: boolean) => {
    if (!socket || !isConnected) return;
    if (isTyping) {
      socket.emit('typing-start', { roomId: roomCode, username });
    } else {
      socket.emit('typing-stop', roomCode);
    }
  }, [socket, isConnected, roomCode, username]);

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

  const handleVoiceStateChange = useCallback((inVoice: boolean, participantCount: number) => {
    setIsInVoice(inVoice);
    setVoiceParticipantCount(participantCount);
  }, []);

  return (
    <>
      <VoiceChannel
        ref={voiceChannelRef}
        roomCode={roomCode}
        socket={socket}
        currentUserId={socket?.id || ''}
        currentUsername={username}
        isConnected={isConnected}
        onVoiceStateChange={handleVoiceStateChange}
      />
      <div className="flex flex-col h-screen bg-black">
        <RoomHeader 
          roomCode={roomCode} 
          users={onlineUsers}
          extendedRetention={extendedRetention}
          onToggleRetention={toggleRetention}
          voiceChannelRef={voiceChannelRef}
          isInVoice={isInVoice}
          voiceParticipantCount={voiceParticipantCount}
        />
      <ChatMessages 
        messages={messages} 
        currentUserId={username} 
        onUpdateMessageTimer={updateMessageTimer}
        onUpdateMessageViewedBy={updateMessageViewedBy}
      />
      {typingUsers.size > 0 && (
        <div className="px-6 py-2 text-sm text-neutral-500 animate-pulse">
          <span className="inline-flex items-center gap-2">
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </span>
            {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing
          </span>
        </div>
      )}
      {(uploadProgress > 0 || downloadProgress > 0 || transferMode || isReceiving) && (
        <div className="px-6 py-3 space-y-2 bg-neutral-900/50 border-t border-neutral-900">
          {transferMode && (
            <div className="flex items-center gap-2.5 text-sm">
              {transferMode === 'p2p' ? (
                <>
                  <span className="text-blue-400 animate-pulse">⚡</span>
                  <span className="text-neutral-300 font-medium">P2P transfer {uploadProgress}%</span>
                </>
              ) : (
                <>
                  <span className="text-emerald-400 animate-pulse">🔒</span>
                  <span className="text-neutral-300 font-medium">Encrypting {uploadProgress}%</span>
                </>
              )}
            </div>
          )}
          {isReceiving && (
            <div className="flex items-center gap-2.5 text-sm">
              <span className="text-blue-400 animate-pulse">📥</span>
              <span className="text-neutral-300 font-medium">Receiving {downloadProgress}%</span>
            </div>
          )}
          {uploadProgress > 0 && (
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-300 rounded-full"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
          {downloadProgress > 0 && (
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 rounded-full"
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
    </>
  );
}

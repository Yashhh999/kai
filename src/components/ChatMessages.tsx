'use client';

import { useEffect, useRef, useState, memo } from 'react';
import { Message } from '@/lib/storage';
import { getFileIcon, formatFileSize, base64ToBlob } from '@/lib/fileUtils';
import ViewOnceEmbed from './ViewOnceEmbed';

interface ChatMessagesProps {
  messages: Message[];
  currentUserId: string;
  onUpdateMessageTimer: (messageId: string, timerStartedAt: number) => void;
  onUpdateMessageViewedBy: (messageId: string, userId: string) => void;
}

const ChatMessages = memo(function ChatMessages({ 
  messages, 
  currentUserId,
  onUpdateMessageTimer,
  onUpdateMessageViewedBy
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [viewedMessages, setViewedMessages] = useState<Set<string>>(new Set());
  const [blurredMessages, setBlurredMessages] = useState<Set<string>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState<Map<string, number>>(new Map());
  const [viewOnceEmbed, setViewOnceEmbed] = useState<{
    imageData: string;
    imageType: string;
    selfDestruct?: number;
    messageId: string;
    downloadable?: boolean;
  } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle self-destruct timers
  useEffect(() => {
    const intervals: NodeJS.Timeout[] = [];

    messages.forEach((message) => {
      if (message.selfDestruct && !blurredMessages.has(message.id) && message.timerStartedAt) {
        const elapsed = Math.floor((Date.now() - message.timerStartedAt) / 1000);
        const remaining = Math.max(0, message.selfDestruct - elapsed);

        if (remaining <= 0) {
          setBlurredMessages(prev => new Set([...prev, message.id]));
        } else {
          if (!timeRemaining.has(message.id)) {
            setTimeRemaining(prev => new Map(prev).set(message.id, remaining));
          }

          const interval = setInterval(() => {
            setTimeRemaining(prev => {
              const newMap = new Map(prev);
              const current = newMap.get(message.id) || 0;
              if (current <= 1) {
                clearInterval(interval);
                setBlurredMessages(prevBlurred => new Set([...prevBlurred, message.id]));
                newMap.delete(message.id);
              } else {
                newMap.set(message.id, current - 1);
              }
              return newMap;
            });
          }, 1000);

          intervals.push(interval);
        }
      }
    });

    return () => {
      intervals.forEach(clearInterval);
    };
  }, [messages, blurredMessages]);

  const handleViewOnce = (msgId: string, selfDestruct?: number, updateStorage?: (msgId: string, timerStartedAt: number) => void) => {
    setViewedMessages(prev => new Set([...prev, msgId]));
    // Mark as viewed in storage with current user ID to persist across sessions
    const message = messages.find(m => m.id === msgId);
    if (message && updateStorage && !message.viewedBy?.includes(currentUserId)) {
      const updatedViewedBy = [...(message.viewedBy || []), currentUserId];
    }
  };

  const handleImageClick = (message: Message) => {
    if (!message.file?.type.startsWith('image/')) return;
    if (!message.file?.data) {
      console.error('No image data available for message:', message.id);
      return;
    }
    
    if (message.viewOnce) {
      const alreadyViewed = message.viewedBy?.includes(currentUserId) || viewedMessages.has(message.id);
      if (!alreadyViewed) {
        handleViewOnce(message.id, message.selfDestruct, onUpdateMessageTimer);
        
        onUpdateMessageViewedBy(message.id, currentUserId);
        
        setViewOnceEmbed({
          imageData: message.file.data,
          imageType: message.file.type,
          selfDestruct: message.selfDestruct,
          messageId: message.id,
          downloadable: message.downloadable,
        });
      }
    } else {
      setViewOnceEmbed({
        imageData: message.file.data,
        imageType: message.file.type,
        selfDestruct: message.selfDestruct,
        messageId: message.id,
        downloadable: message.downloadable,
      });
    }
  };

  const closeViewOnceEmbed = () => {
    if (viewOnceEmbed?.selfDestruct && viewOnceEmbed.messageId) {
      setBlurredMessages(prev => new Set([...prev, viewOnceEmbed.messageId]));
    }
    setViewOnceEmbed(null);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const downloadFile = (file: { name: string; data: string; type: string }) => {
    const blob = base64ToBlob(file.data, file.type);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {viewOnceEmbed && (
        <ViewOnceEmbed
          imageData={viewOnceEmbed.imageData}
          imageType={viewOnceEmbed.imageType}
          selfDestruct={viewOnceEmbed.selfDestruct}
          downloadable={viewOnceEmbed.downloadable}
          onClose={closeViewOnceEmbed}
        />
      )}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 sm:space-y-4">
        {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-neutral-600 text-sm">Send a message to begin</p>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.isSent ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-200`}
          >
            <div className="max-w-[85%] sm:max-w-[70%]">
              {!message.isSent && (
                <div className="text-xs text-neutral-600 mb-1 ml-2 font-medium">{message.senderName}</div>
              )}
              <div
                className={`rounded-2xl px-4 py-2.5 shadow-lg transition-all ${
                  message.isSent
                    ? 'bg-white text-black'
                    : 'bg-neutral-900 text-neutral-100 border border-neutral-800'
                }`}
              >
                {message.type === 'file' && message.file ? (
                  <div className="space-y-2">
                    {message.file.thumbnail && (
                      <div className="relative">
                        {message.viewOnce && (message.viewedBy?.includes(currentUserId) || viewedMessages.has(message.id)) ? (
                          <div className="bg-neutral-900 rounded-xl p-8 text-center border border-neutral-800">
                            <p className="text-neutral-600 text-sm">👁️ Photo viewed</p>
                          </div>
                        ) : blurredMessages.has(message.id) ? (
                          <div className="bg-neutral-900 rounded-xl p-8 text-center border border-neutral-800">
                            <p className="text-neutral-600 text-sm">⏱️ Photo expired</p>
                          </div>
                        ) : (
                          <>
                            <img 
                              src={
                                message.file.data 
                                  ? (message.viewOnce && !(message.viewedBy?.includes(currentUserId) || viewedMessages.has(message.id))
                                      ? (message.file.thumbnail ? `data:${message.file.type};base64,${message.file.thumbnail}` : '')
                                      : `data:${message.file.type};base64,${message.file.data}`)
                                  : (message.file.thumbnail ? `data:${message.file.type};base64,${message.file.thumbnail}` : '')
                              }
                              alt="Image" 
                              className={`max-w-full rounded-xl cursor-pointer hover:opacity-90 transition-all select-none ${
                                message.viewOnce && !(message.viewedBy?.includes(currentUserId) || viewedMessages.has(message.id))
                                  ? 'blur-2xl' 
                                  : ''
                              }`}
                              style={{ maxHeight: '300px', objectFit: 'contain', userSelect: 'none', WebkitUserSelect: 'none' }}
                              onClick={() => handleImageClick(message)}
                              onContextMenu={(e) => e.preventDefault()}
                              onDragStart={(e) => e.preventDefault()}
                              draggable={false}
                            />
                          </>
                        )}
                        {message.viewOnce && !(message.viewedBy?.includes(currentUserId) || viewedMessages.has(message.id)) && !blurredMessages.has(message.id) && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-black/80 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs text-white font-medium">
                              👁️ Tap to view once
                            </div>
                          </div>
                        )}
                        {message.selfDestruct && !blurredMessages.has(message.id) && (
                          <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-sm px-2 py-1 rounded-lg text-xs text-white font-semibold pointer-events-none shadow-lg">
                            ⏱️ {timeRemaining.get(message.id) || message.selfDestruct}s
                          </div>
                        )}
                      </div>
                    )}
                    {(message.viewOnce || message.selfDestruct || !message.file.type.startsWith('image/')) && (!(message.viewedBy?.includes(currentUserId) || viewedMessages.has(message.id)) || message.isSent) && !blurredMessages.has(message.id) && (
                      <div className="flex items-center gap-2.5 mt-2">
                        <span className="text-2xl flex-shrink-0">{getFileIcon(message.file.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{message.file.name}</p>
                          <p className="text-xs opacity-60 mt-0.5">{formatFileSize(message.file.size)}</p>
                        </div>
                        {message.downloadable === true && message.file.data && (
                          <button
                            onClick={() => downloadFile(message.file!)}
                            className="text-xs px-3 py-1.5 bg-black/20 hover:bg-black/30 rounded-lg transition-all font-medium"
                          >
                            Download
                          </button>
                        )}
                      </div>
                    )}
                    {message.content && (
                      <p className="text-sm mt-2 opacity-95">{message.content}</p>
                    )}
                  </div>
                ) : (
                  <>
                    {message.selfDestruct && !blurredMessages.has(message.id) ? (
                      <div className="relative">
                        <p className="text-sm leading-relaxed">{message.content}</p>
                        <div className="absolute -top-1.5 -right-1.5 bg-red-500 px-2 py-0.5 rounded-full text-xs text-white font-bold shadow-lg shadow-red-500/50 animate-pulse">
                          ⏱️ {timeRemaining.get(message.id) || message.selfDestruct}s
                        </div>
                      </div>
                    ) : blurredMessages.has(message.id) ? (
                      <p className="text-neutral-600 italic text-sm">⏱️ Message expired</p>
                    ) : (
                      <p className="text-sm leading-relaxed">{message.content}</p>
                    )}
                    <p className={`text-xs mt-1.5 ${message.isSent ? 'text-neutral-600' : 'text-neutral-600'}`}>
                      {formatTime(message.timestamp)}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
    </>
  );
});

export default ChatMessages;

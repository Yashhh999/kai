'use client';

import { useEffect, useRef, useState, memo } from 'react';
import { Message } from '@/lib/storage';
import { getFileIcon, formatFileSize, base64ToBlob } from '@/lib/fileUtils';
import ViewOnceEmbed from './ViewOnceEmbed';

interface ChatMessagesProps {
  messages: Message[];
  currentUserId: string;
  onEditMessage: (messageId: string, newContent: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onUpdateMessageTimer: (messageId: string, timerStartedAt: number) => void;
  editingMessage: string | null;
  setEditingMessage: (id: string | null) => void;
}

const ChatMessages = memo(function ChatMessages({ 
  messages, 
  currentUserId, 
  onEditMessage,
  onDeleteMessage,
  onUpdateMessageTimer,
  editingMessage,
  setEditingMessage 
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [editContent, setEditContent] = useState('');
  const [showOriginal, setShowOriginal] = useState<string | null>(null);
  const [viewedMessages, setViewedMessages] = useState<Set<string>>(new Set());
  const [blurredMessages, setBlurredMessages] = useState<Set<string>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState<Map<string, number>>(new Map());
  const [viewOnceEmbed, setViewOnceEmbed] = useState<{
    imageData: string;
    imageType: string;
    selfDestruct?: number;
    messageId: string;
  } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle self-destruct timers
  useEffect(() => {
    const intervals: NodeJS.Timeout[] = [];

    messages.forEach((message) => {
      // Process any message with self-destruct timer that has been started
      if (message.selfDestruct && !blurredMessages.has(message.id) && message.timerStartedAt) {
        // Calculate remaining time based on when timer started
        const elapsed = Math.floor((Date.now() - message.timerStartedAt) / 1000);
        const remaining = Math.max(0, message.selfDestruct - elapsed);

        if (remaining <= 0) {
          // Timer already expired
          setBlurredMessages(prev => new Set([...prev, message.id]));
        } else {
          // Set initial remaining time
          if (!timeRemaining.has(message.id)) {
            setTimeRemaining(prev => new Map(prev).set(message.id, remaining));
          }

          // Start countdown interval
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
    // Don't start the main timer for view-once - ViewOnceEmbed handles it completely
  };

  const handleImageClick = (message: Message) => {
    if (!message.file?.type.startsWith('image/')) return;
    
    if (message.viewOnce) {
      // View-once works for both sent and received messages
      if (!viewedMessages.has(message.id)) {
        if (!message.file?.data) {
          console.error('No image data available for view-once message:', message.id);
          return;
        }
        // Mark as viewed and open embed - ViewOnceEmbed handles timer completely
        handleViewOnce(message.id, message.selfDestruct, undefined);
        setViewOnceEmbed({
          imageData: message.file.data,
          imageType: message.file.type,
          selfDestruct: message.selfDestruct,
          messageId: message.id
        });
      }
    } else if (message.file?.data) {
      // Normal images or self-destruct without view-once - open in new tab
      const blob = base64ToBlob(message.file.data, message.file.type);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
  };

  const closeViewOnceEmbed = () => {
    if (viewOnceEmbed?.selfDestruct && viewOnceEmbed.messageId) {
      // If it had a self-destruct timer, blur it immediately
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

  const startEdit = (msg: Message) => {
    setEditingMessage(msg.id);
    setEditContent(msg.content);
  };

  const saveEdit = (msgId: string) => {
    if (editContent.trim()) {
      onEditMessage(msgId, editContent.trim());
    }
    setEditingMessage(null);
  };

  const handleDelete = (msgId: string) => {
    if (window.confirm('Delete this message?')) {
      onDeleteMessage(msgId);
    }
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
          onClose={closeViewOnceEmbed}
        />
      )}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-neutral-500 text-sm">Send a message to start</p>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.isSent ? 'justify-end' : 'justify-start'}`}
          >
            <div className="max-w-[70%]">
              {!message.isSent && (
                <div className="text-xs text-neutral-500 mb-1 ml-1">{message.senderName}</div>
              )}
              <div
                className={`rounded-lg px-4 py-2 shadow-lg ${
                  message.isSent
                    ? 'bg-white text-black'
                    : 'bg-neutral-800 text-neutral-100 border border-neutral-700'
                }`}
              >
                {message.type === 'deleted' ? (
                  <p className="text-neutral-500 italic text-sm">Message deleted</p>
                ) : message.type === 'file' && message.file ? (
                  <div className="space-y-2">
                    {message.file.thumbnail && (
                      <div className="relative">
                        {message.viewOnce && viewedMessages.has(message.id) ? (
                          <div className="bg-neutral-800 rounded p-8 text-center">
                            <p className="text-neutral-500 text-sm">👁️ Photo viewed</p>
                          </div>
                        ) : blurredMessages.has(message.id) ? (
                          <div className="bg-neutral-800 rounded p-8 text-center">
                            <p className="text-neutral-500 text-sm">⏱️ Photo expired</p>
                          </div>
                        ) : (
                          <>
                            <img 
                              src={
                                message.file.data 
                                  ? (message.viewOnce && !viewedMessages.has(message.id)
                                      ? message.file.thumbnail
                                      : `data:${message.file.type};base64,${message.file.data}`)
                                  : message.file.thumbnail
                              }
                              alt="Image" 
                              className={`max-w-full rounded cursor-pointer hover:opacity-90 transition-opacity ${
                                message.viewOnce && !viewedMessages.has(message.id) 
                                  ? 'blur-xl' 
                                  : ''
                              }`}
                              onClick={() => handleImageClick(message)}
                            />
                          </>
                        )}
                        {message.viewOnce && !viewedMessages.has(message.id) && !blurredMessages.has(message.id) && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-black/70 px-3 py-1 rounded-full text-xs text-white">
                              👁️ Tap to view once
                            </div>
                          </div>
                        )}
                        {message.selfDestruct && !blurredMessages.has(message.id) && (
                          <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-white pointer-events-none">
                            ⏱️ {timeRemaining.get(message.id) || message.selfDestruct}s
                          </div>
                        )}
                      </div>
                    )}
                    {/* Only show file info for: view-once, self-destruct, or non-image files */}
                    {(message.viewOnce || message.selfDestruct || !message.file.type.startsWith('image/')) && (!viewedMessages.has(message.id) || message.isSent) && !blurredMessages.has(message.id) && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-2xl">{getFileIcon(message.file.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{message.file.name}</p>
                          <p className="text-xs opacity-70">{formatFileSize(message.file.size)}</p>
                        </div>
                        {(message.downloadable !== false) && message.file.data && (
                          <button
                            onClick={() => downloadFile(message.file!)}
                            className="text-xs px-2 py-1 bg-black/20 rounded hover:bg-black/30 transition-colors"
                          >
                            Download
                          </button>
                        )}
                      </div>
                    )}
                    {message.content && (
                      <p className="text-sm mt-2 opacity-90">{message.content}</p>
                    )}
                    {message.isSent && (
                      <button
                        onClick={() => handleDelete(message.id)}
                        className="text-xs text-neutral-500 hover:text-red-400 mt-2 block"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                ) : editingMessage === message.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(message.id);
                        if (e.key === 'Escape') setEditingMessage(null);
                      }}
                      className="w-full bg-transparent border-b border-neutral-500 outline-none"
                      autoFocus
                    />
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => saveEdit(message.id)} className="text-green-400">Save</button>
                      <button onClick={() => setEditingMessage(null)} className="text-red-400">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="wrap-break-word">{message.content}</p>
                    <p className={`text-xs mt-1 ${message.isSent ? 'text-neutral-600' : 'text-neutral-500'}`}>
                      {formatTime(message.timestamp)}
                      {message.editedAt && ' (edited)'}
                    </p>
                    {message.isSent && !message.type && (
                      <div className="flex gap-2 mt-1">
                        <button
                          onClick={() => startEdit(message)}
                          className="text-xs text-neutral-500 hover:text-neutral-300"
                        >
                           Edit
                        </button>
                        <button
                          onClick={() => handleDelete(message.id)}
                          className="text-xs text-neutral-500 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    )}

                    {message.originalContent && (
                      <>
                        <button
                          onClick={() => setShowOriginal(showOriginal === message.id ? null : message.id)}
                          className="text-xs text-blue-400 mt-1"
                        >
                          {showOriginal === message.id ? 'Hide' : 'Show'} original
                        </button>
                        {showOriginal === message.id && (
                          <div className="mt-2 pt-2 border-t border-neutral-600 text-sm opacity-70">
                            {message.originalContent}
                          </div>
                        )}
                      </>
                    )}
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

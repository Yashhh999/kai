'use client';

import { useEffect, useRef, useState } from 'react';
import { Message } from '@/lib/storage';
import { getFileIcon, formatFileSize, base64ToBlob } from '@/lib/fileUtils';

interface ChatMessagesProps {
  messages: Message[];
  currentUserId: string;
  onEditMessage: (messageId: string, newContent: string) => void;
  onDeleteMessage: (messageId: string) => void;
  editingMessage: string | null;
  setEditingMessage: (id: string | null) => void;
}

export default function ChatMessages({ 
  messages, 
  currentUserId, 
  onEditMessage,
  onDeleteMessage,
  editingMessage,
  setEditingMessage 
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [editContent, setEditContent] = useState('');
  const [showOriginal, setShowOriginal] = useState<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    const blob = base64ToBlob(file.data);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
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
                className={`rounded-lg px-4 py-2 ${
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
                      <img 
                        src={message.file.thumbnail} 
                        alt="Preview" 
                        className="max-w-full rounded cursor-pointer"
                        onClick={() => {
                          if (message.file?.type.startsWith('image/')) {
                            const blob = base64ToBlob(message.file.data);
                            const url = URL.createObjectURL(blob);
                            window.open(url, '_blank');
                          }
                        }}
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{getFileIcon(message.file.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{message.file.name}</p>
                        <p className="text-xs opacity-70">{formatFileSize(message.file.size)}</p>
                      </div>
                      <button
                        onClick={() => downloadFile(message.file!)}
                        className="text-xs px-2 py-1 bg-black/20 rounded hover:bg-black/30"
                      >
                        Download
                      </button>
                    </div>
                    {message.content && (
                      <p className="text-sm mt-2 opacity-90">{message.content}</p>
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
                    <div className="flex items-center justify-between mt-1">
                      <p className={`text-xs ${message.isSent ? 'text-neutral-600' : 'text-neutral-500'}`}>
                        {formatTime(message.timestamp)}
                        {message.editedAt && ' (edited)'}
                      </p>
                      {message.isSent && !message.type && (
                        <div className="flex gap-2">
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
                      {message.isSent && message.type === 'file' && (
                        <button
                          onClick={() => handleDelete(message.id)}
                          className="text-xs text-neutral-500 hover:text-red-400"
                        >
                          Delete
                        </button>
                      )}
                    </div>
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
  );
}

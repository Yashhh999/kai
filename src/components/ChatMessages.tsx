'use client';

import { useEffect, useRef, useState } from 'react';
import { Message } from '@/lib/storage';

interface ChatMessagesProps {
  messages: Message[];
  currentUserId: string;
  onEditMessage: (messageId: string, newContent: string) => void;
  editingMessage: string | null;
  setEditingMessage: (id: string | null) => void;
}

export default function ChatMessages({ 
  messages, 
  currentUserId, 
  onEditMessage,
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

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">Send a message to start</p>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.isSent ? 'justify-end' : 'justify-start'}`}
          >
            <div className="max-w-[70%]">
              {!message.isSent && (
                <div className="text-xs text-gray-500 mb-1 ml-1">{message.senderName}</div>
              )}
              <div
                className={`rounded-lg px-4 py-2 ${
                  message.isSent
                    ? 'bg-white text-black'
                    : 'bg-gray-800 text-gray-100 border border-gray-700'
                }`}
              >
                {editingMessage === message.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(message.id);
                        if (e.key === 'Escape') setEditingMessage(null);
                      }}
                      className="w-full bg-transparent border-b border-gray-500 outline-none"
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
                      <p className={`text-xs ${message.isSent ? 'text-gray-600' : 'text-gray-500'}`}>
                        {formatTime(message.timestamp)}
                        {message.editedAt && ' (edited)'}
                      </p>
                      {message.isSent && (
                        <button
                          onClick={() => startEdit(message)}
                          className="text-xs text-gray-500 hover:text-gray-300 ml-2"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    {message.originalContent && (
                      <button
                        onClick={() => setShowOriginal(showOriginal === message.id ? null : message.id)}
                        className="text-xs text-blue-400 mt-1"
                      >
                        {showOriginal === message.id ? 'Hide' : 'Show'} original
                      </button>
                    )}
                    {showOriginal === message.id && message.originalContent && (
                      <div className="mt-2 pt-2 border-t border-gray-600 text-sm opacity-70">
                        {message.originalContent}
                      </div>
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

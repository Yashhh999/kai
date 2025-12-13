'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import { formatFileSize, getFileIcon } from '@/lib/fileUtils';

interface ChatInputProps {
  onSendMessage: (message: string, attachment?: { file: File; useP2P: boolean }) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSendMessage, onTyping, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<{ file: File; useP2P: boolean } | null>(null);
  const [showP2PModal, setShowP2PModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if ((message.trim() || attachment) && !disabled) {
      onSendMessage(message.trim(), attachment || undefined);
      setMessage('');
      setAttachment(null);
      onTyping(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPendingFile(file);
      setShowP2PModal(true);
    }
    e.target.value = '';
  };

  const handleP2PChoice = (useP2P: boolean) => {
    if (pendingFile) {
      if (!useP2P && pendingFile.size > 10 * 1024 * 1024) {
        setAttachment({ file: pendingFile, useP2P: true });
      } else {
        setAttachment({ file: pendingFile, useP2P });
      }
    }
    setShowP2PModal(false);
    setPendingFile(null);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setPendingFile(file);
      setShowP2PModal(true);
    }
  };

  const handleChange = (value: string) => {
    setMessage(value);
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    if (value.trim()) {
      onTyping(true);
      typingTimeoutRef.current = setTimeout(() => onTyping(false), 2000);
    } else {
      onTyping(false);
    }
  };

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <form onSubmit={handleSubmit} className="border-t border-neutral-800 p-4"
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {attachment && (
          <div className="mb-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg flex items-center gap-3">
            <span className="text-2xl">{getFileIcon(attachment.file.type)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-neutral-100 truncate">{attachment.file.name}</p>
              <p className="text-xs text-neutral-500">
                {formatFileSize(attachment.file.size)} • {attachment.useP2P ? 'P2P Transfer' : 'Direct'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-neutral-500 hover:text-red-400 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className={`flex gap-2 ${dragActive ? 'ring-2 ring-white rounded-lg p-1' : ''}`}>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Attach file"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            type="text"
            value={message}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={attachment ? 'Add a caption (optional)...' : 'Type a message...'}
            disabled={disabled}
            className="flex-1 bg-black border border-neutral-800 rounded-lg px-4 py-3 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || (!message.trim() && !attachment)}
            className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>

      {showP2PModal && pendingFile && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-white mb-2">Choose Transfer Method</h3>
            <p className="text-sm text-neutral-400 mb-1">File: <span className="text-neutral-200">{pendingFile.name}</span></p>
            <p className="text-sm text-neutral-400 mb-4">Size: <span className="text-neutral-200">{formatFileSize(pendingFile.size)}</span></p>
            
            <div className="space-y-3 mb-6">
              <div className="p-3 bg-neutral-800 rounded border border-neutral-700">
                <h4 className="text-sm font-medium text-white mb-1">🔒 Normal (Encrypted via Server)</h4>
                <p className="text-xs text-neutral-400">Max 10MB. Encrypted end-to-end. Server relays data.</p>
                {pendingFile.size > 10 * 1024 * 1024 && (
                  <p className="text-xs text-red-400 mt-1">⚠️ File too large for normal transfer</p>
                )}
              </div>
              <div className="p-3 bg-neutral-800 rounded border border-neutral-700">
                <h4 className="text-sm font-medium text-white mb-1">⚡ P2P (Direct Connection)</h4>
                <p className="text-xs text-neutral-400">Any size. Direct peer-to-peer. Both users must be online.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleP2PChoice(false)}
                disabled={pendingFile.size > 10 * 1024 * 1024}
                className="flex-1 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Normal
              </button>
              <button
                onClick={() => handleP2PChoice(true)}
                className="flex-1 px-4 py-2 bg-neutral-700 text-white rounded-lg font-medium hover:bg-neutral-600 transition-colors"
              >
                P2P
              </button>
              <button
                onClick={() => {
                  setShowP2PModal(false);
                  setPendingFile(null);
                }}
                className="px-4 py-2 text-neutral-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

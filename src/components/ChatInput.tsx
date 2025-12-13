'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import { formatFileSize, getFileIcon } from '@/lib/fileUtils';

interface ChatInputProps {
  onSendMessage: (message: string, attachment?: { file: File; useP2P: boolean; viewOnce?: boolean; selfDestruct?: number; downloadable?: boolean }) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSendMessage, onTyping, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<{ file: File; useP2P: boolean; viewOnce?: boolean; selfDestruct?: number; downloadable?: boolean } | null>(null);
  const [showP2PModal, setShowP2PModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingP2P, setPendingP2P] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState<number>(0);
  const [downloadable, setDownloadable] = useState(true);
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
      const isImage = pendingFile.type.startsWith('image/');
      setPendingP2P(useP2P || pendingFile.size > 10 * 1024 * 1024);
      
      if (isImage) {
        setShowP2PModal(false);
        setShowOptionsModal(true);
      } else {
        if (!useP2P && pendingFile.size > 10 * 1024 * 1024) {
          setAttachment({ file: pendingFile, useP2P: true });
        } else {
          setAttachment({ file: pendingFile, useP2P });
        }
        setShowP2PModal(false);
        setPendingFile(null);
      }
    }
  };

  const handleOptionsConfirm = () => {
    if (pendingFile) {
      setAttachment({ 
        file: pendingFile, 
        useP2P: pendingP2P,
        viewOnce,
        selfDestruct: selfDestruct > 0 ? selfDestruct : undefined,
        downloadable
      });
    }
    setShowOptionsModal(false);
    setPendingFile(null);
    setViewOnce(false);
    setSelfDestruct(0);
    setDownloadable(true);
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
                {formatFileSize(attachment.file.size)} • {attachment.useP2P ? 'P2P' : 'Direct'}
                {attachment.viewOnce && ' • 👁️ View Once'}
                {attachment.selfDestruct && ` • ⏱️ ${attachment.selfDestruct}s`}
                {!attachment.downloadable && ' • 🚫 No Download'}
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

      {showOptionsModal && pendingFile && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-white mb-4">Photo Options</h3>
            
            <div className="space-y-4 mb-6">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-white">👁️ View Once</p>
                  <p className="text-xs text-neutral-400">Photo disappears after viewing</p>
                </div>
                <input
                  type="checkbox"
                  checked={viewOnce}
                  onChange={(e) => {
                    setViewOnce(e.target.checked);
                    if (e.target.checked) setDownloadable(false);
                  }}
                  className="w-5 h-5 rounded bg-neutral-800 border-neutral-600"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-white">📥 Downloadable</p>
                  <p className="text-xs text-neutral-400">Allow download button</p>
                </div>
                <input
                  type="checkbox"
                  checked={downloadable}
                  onChange={(e) => setDownloadable(e.target.checked)}
                  disabled={viewOnce || selfDestruct > 0}
                  className="w-5 h-5 rounded bg-neutral-800 border-neutral-600 disabled:opacity-50"
                />
              </label>

              <div>
                <label className="block mb-2">
                  <p className="text-sm font-medium text-white mb-1">⏱️ Self-Destruct Timer</p>
                  <p className="text-xs text-neutral-400 mb-2">Enter time in seconds (1-120, 0 = disabled)</p>
                </label>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={selfDestruct}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(120, Number(e.target.value) || 0));
                    setSelfDestruct(val);
                    if (val > 0) setDownloadable(false);
                  }}
                  placeholder="0"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-white"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleOptionsConfirm}
                className="flex-1 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-neutral-200 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => {
                  setShowOptionsModal(false);
                  setPendingFile(null);
                  setViewOnce(false);
                  setSelfDestruct(0);
                  setDownloadable(true);
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

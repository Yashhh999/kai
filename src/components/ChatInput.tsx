'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import { formatFileSize, getFileIcon } from '@/lib/fileUtils';

interface ChatInputProps {
  onSendMessage: (message: string, options?: { selfDestruct?: number; attachment?: { file: File; useP2P: boolean; viewOnce?: boolean; selfDestruct?: number; downloadable?: boolean } }) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSendMessage, onTyping, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [messageSelfDestruct, setMessageSelfDestruct] = useState<number>(0);
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
      onSendMessage(message.trim(), {
        selfDestruct: messageSelfDestruct > 0 ? messageSelfDestruct : undefined,
        attachment: attachment || undefined
      });
      setMessage('');
      setAttachment(null);
      setMessageSelfDestruct(0);
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
      typingTimeoutRef.current = setTimeout(() => onTyping(false), 3000);
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
      <form onSubmit={handleSubmit} className="border-t border-neutral-900 bg-black/50 backdrop-blur-xl p-3 sm:p-4"
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {attachment && (
          <div className="mb-3 p-3 bg-neutral-900/70 border border-neutral-800 rounded-xl flex items-center gap-3 backdrop-blur group hover:bg-neutral-900 transition-all">
            <span className="text-2xl flex-shrink-0">{getFileIcon(attachment.file.type)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-neutral-100 truncate font-medium">{attachment.file.name}</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {formatFileSize(attachment.file.size)} · {attachment.useP2P ? '⚡ P2P' : '🔒 Encrypted'}
                {attachment.viewOnce && ' · 👁️ View Once'}
                {attachment.selfDestruct && ` · ⏱️ ${attachment.selfDestruct}s`}
                {!attachment.downloadable && ' · 🚫 Protected'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-neutral-600 hover:text-red-400 transition-all p-1.5 rounded-lg hover:bg-red-500/10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className={`flex gap-2 transition-all ${dragActive ? 'ring-2 ring-white/50 rounded-xl p-1' : ''}`}>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            disabled={disabled}
          />
          {!attachment && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMessageSelfDestruct(prev => prev > 0 ? 0 : 10)}
                disabled={disabled}
                className={`p-2.5 rounded-xl transition-all disabled:opacity-50 min-w-[44px] flex items-center justify-center ${
                  messageSelfDestruct > 0 
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 shadow-lg shadow-red-500/20' 
                    : 'text-neutral-500 hover:text-white hover:bg-neutral-800/50'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              {messageSelfDestruct > 0 && (
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={messageSelfDestruct}
                  onChange={(e) => setMessageSelfDestruct(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                  className="w-14 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1.5 text-neutral-100 text-xs focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-transparent"
                  placeholder="10s"
                />
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-2.5 rounded-xl text-neutral-500 hover:text-white hover:bg-neutral-800/50 transition-all disabled:opacity-50 min-w-[44px] flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            type="text"
            value={message}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={attachment ? 'Caption (optional)' : 'Message...'}
            disabled={disabled}
            className="flex-1 bg-neutral-900/50 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/50 focus:border-transparent focus:bg-neutral-900 disabled:opacity-50 transition-all"
          />
          <button
            type="submit"
            disabled={disabled || (!message.trim() && !attachment)}
            className="bg-white text-black px-5 py-2.5 rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 text-sm shadow-lg"
          >
            Send
          </button>
        </div>
      </form>

      {showP2PModal && pendingFile && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-neutral-900/95 border border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl backdrop-blur-xl">
            <h3 className="text-lg font-semibold text-white mb-3">Transfer Method</h3>
            <div className="space-y-1.5 mb-5 text-sm">
              <p className="text-neutral-400">File: <span className="text-white font-medium">{pendingFile.name}</span></p>
              <p className="text-neutral-400">Size: <span className="text-white font-medium">{formatFileSize(pendingFile.size)}</span></p>
            </div>
            
            <div className="space-y-2.5 mb-6">
              <button
                onClick={() => handleP2PChoice(false)}
                disabled={pendingFile.size > 10 * 1024 * 1024}
                className="w-full p-4 bg-neutral-800/70 hover:bg-neutral-800 rounded-xl border border-neutral-700 hover:border-neutral-600 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <h4 className="text-sm font-semibold text-white mb-1 group-hover:text-white transition-colors">🔒 Normal Transfer</h4>
                <p className="text-xs text-neutral-400">Max 10MB · End-to-end encrypted via server</p>
                {pendingFile.size > 10 * 1024 * 1024 && (
                  <p className="text-xs text-red-400 mt-1.5">⚠️ File exceeds 10MB limit</p>
                )}
              </button>
              <button
                onClick={() => handleP2PChoice(true)}
                className="w-full p-4 bg-neutral-800/70 hover:bg-neutral-800 rounded-xl border border-neutral-700 hover:border-neutral-600 transition-all text-left group"
              >
                <h4 className="text-sm font-semibold text-white mb-1 group-hover:text-white transition-colors">⚡ P2P Transfer</h4>
                <p className="text-xs text-neutral-400">Unlimited size · Direct peer connection</p>
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowP2PModal(false); setPendingFile(null); }}
                className="flex-1 px-4 py-2.5 bg-neutral-800 text-white rounded-xl font-medium hover:bg-neutral-700 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showOptionsModal && pendingFile && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-neutral-900/95 border border-neutral-700 rounded-2xl p-6 max-w-md w-full shadow-2xl backdrop-blur-xl">
            <h3 className="text-lg font-semibold text-white mb-5">Photo Settings</h3>
            
            <div className="space-y-4 mb-6">
              <label className="flex items-start justify-between cursor-pointer group p-3 rounded-xl hover:bg-neutral-800/50 transition-all">
                <div className="flex-1">
                  <p className="text-sm font-medium text-white group-hover:text-white transition-colors">👁️ View Once</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Photo disappears after viewing</p>
                </div>
                <input
                  type="checkbox"
                  checked={viewOnce}
                  onChange={(e) => { setViewOnce(e.target.checked); if (e.target.checked) setDownloadable(false); }}
                  className="w-5 h-5 mt-0.5 rounded bg-neutral-800 border-neutral-600 text-white focus:ring-2 focus:ring-white/50 transition-all"
                />
              </label>

              <label className="flex items-start justify-between cursor-pointer group p-3 rounded-xl hover:bg-neutral-800/50 transition-all">
                <div className="flex-1">
                  <p className="text-sm font-medium text-white group-hover:text-white transition-colors">📥 Downloadable</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Allow download button</p>
                </div>
                <input
                  type="checkbox"
                  checked={downloadable}
                  onChange={(e) => setDownloadable(e.target.checked)}
                  disabled={viewOnce || selfDestruct > 0}
                  className="w-5 h-5 mt-0.5 rounded bg-neutral-800 border-neutral-600 text-white focus:ring-2 focus:ring-white/50 disabled:opacity-50 transition-all"
                />
              </label>

              <div className="p-3 rounded-xl bg-neutral-800/50">
                <p className="text-sm font-medium text-white mb-2">⏱️ Self-Destruct Timer</p>
                <p className="text-xs text-neutral-500 mb-3">Time in seconds (1-120, 0 = off)</p>
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
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2.5 text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-white/50 transition-all"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleOptionsConfirm}
                className="flex-1 px-4 py-2.5 bg-white text-black rounded-xl font-medium hover:bg-neutral-200 active:scale-95 transition-all shadow-lg"
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
                className="px-4 py-2.5 bg-neutral-800 text-white rounded-xl font-medium hover:bg-neutral-700 transition-all"
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

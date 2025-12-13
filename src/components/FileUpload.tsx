'use client';

import { useRef, useState } from 'react';
import { isFileTooLarge, formatFileSize } from '@/lib/fileUtils';

interface FileUploadProps {
  onFileSelect: (file: File, useP2P: boolean) => void;
  disabled?: boolean;
}

export default function FileUpload({ onFileSelect, disabled }: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFile = (file: File) => {
    if (!file) return;

    const needsP2P = isFileTooLarge(file.size);
    
    if (needsP2P) {
      const confirm = window.confirm(
        `File is ${formatFileSize(file.size)}. Files over 10MB require P2P transfer (both users must be online). Continue?`
      );
      if (!confirm) return;
    }

    onFileSelect(file, needsP2P);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
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
    if (file) handleFile(file);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleChange}
        className="hidden"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={handleClick}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        disabled={disabled}
        className={`p-2 rounded-lg transition-colors ${
          dragActive
            ? 'bg-white text-black'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title="Upload file (max 10MB direct, larger via P2P)"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      </button>
    </>
  );
}

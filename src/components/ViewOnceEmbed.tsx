'use client';

import React, { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';
import { base64ToBlob } from '@/lib/fileUtils';

interface ViewOnceEmbedProps {
  imageData: string;
  imageType: string;
  selfDestruct?: number;
  downloadable?: boolean;
  onClose: () => void;
}

export default function ViewOnceEmbed({ 
  imageData, 
  imageType, 
  selfDestruct,
  downloadable = false,
  onClose 
}: ViewOnceEmbedProps) {
  const [timeRemaining, setTimeRemaining] = useState(selfDestruct || 0);
  const [imageError, setImageError] = useState(false);

  // Prevent right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    return false;
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.preventDefault();
    return false;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) && 
        (e.key === 'c' || e.key === 's' || e.key === 'p' || e.key === 'a')
      ) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        return false;
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('copy', handleCopy, true);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('copy', handleCopy, true);
    };
  }, []);

  const handleDownload = () => {
    if (!downloadable) return;
    
    const blob = base64ToBlob(imageData, imageType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `image-${Date.now()}.${imageType.split('/')[1] || 'png'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!imageData || imageData.trim() === '') {
    console.error('ViewOnceEmbed: No image data provided');
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={onClose}>
        <div className="text-white text-center">
          <p className="text-xl mb-4">❌ Failed to load image</p>
          <p className="text-sm text-neutral-400">No image data available</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-white/20 rounded-lg">Close</button>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (selfDestruct && selfDestruct > 0) {
      setTimeRemaining(selfDestruct);
      
      let currentTime = selfDestruct;
      
      const interval = setInterval(() => {
        currentTime -= 1;
        setTimeRemaining(currentTime);
        
        if (currentTime <= 0) {
          clearInterval(interval);
          setTimeout(() => onClose(), 0);
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [selfDestruct, onClose]);

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center backdrop-blur-sm" 
      onClick={onClose}
      onContextMenu={handleContextMenu}
      onCopy={(e) => e.preventDefault()}
      style={{ 
        userSelect: 'none', 
        WebkitUserSelect: 'none', 
        MozUserSelect: 'none', 
        msUserSelect: 'none',
        WebkitTouchCallout: 'none'
      }}
    >
      <div 
        className="relative w-full h-full flex flex-col items-center justify-center p-4" 
        onClick={(e) => e.stopPropagation()}
        onContextMenu={handleContextMenu}
        onCopy={(e) => e.preventDefault()}
        style={{ 
          userSelect: 'none', 
          WebkitUserSelect: 'none', 
          MozUserSelect: 'none', 
          msUserSelect: 'none',
          WebkitTouchCallout: 'none'
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all z-10 backdrop-blur-md"
          aria-label="Close"
        >
          <X className="w-6 h-6 text-white" />
        </button>

        {downloadable && (
          <button
            onClick={handleDownload}
            className="absolute top-4 right-20 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all z-10 backdrop-blur-md"
            aria-label="Download"
          >
            <Download className="w-6 h-6 text-white" />
          </button>
        )}

        {selfDestruct && selfDestruct > 0 && timeRemaining > 0 && (
          <div className="absolute top-4 left-4 px-4 py-2 bg-red-500/90 rounded-full text-white text-sm font-semibold z-10 backdrop-blur-md animate-pulse">
            ⏱️ {timeRemaining}s
          </div>
        )}

        {!imageError ? (
          <img
            src={`data:${imageType};base64,${imageData}`}
            alt="Image viewer"
            className="max-w-[95%] max-h-[95%] object-contain rounded-lg shadow-2xl select-none"
            style={{ 
              userSelect: 'none', 
              WebkitUserSelect: 'none', 
              MozUserSelect: 'none', 
              msUserSelect: 'none',
              WebkitTouchCallout: 'none',
              pointerEvents: 'none'
            }}
            onError={() => setImageError(true)}
            onContextMenu={handleContextMenu}
            onDragStart={handleDragStart}
            onCopy={(e) => e.preventDefault()}
            draggable={false}
          />
        ) : (
          <div className="text-white text-center">
            <p className="text-xl mb-4">❌ Failed to load image</p>
            <p className="text-sm text-neutral-400">Image data may be corrupted</p>
          </div>
        )}

        {/* Instruction text */}
        <p className="absolute bottom-4 text-neutral-400 text-sm text-center px-4">
          {selfDestruct && selfDestruct > 0 
            ? 'This photo will disappear automatically' 
            : downloadable 
              ? 'Click download button to save' 
              : 'Screenshot protection enabled'}
        </p>
      </div>
    </div>
  );
}

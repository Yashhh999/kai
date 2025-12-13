'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface ViewOnceEmbedProps {
  imageData: string;
  imageType: string;
  selfDestruct?: number;
  onClose: () => void;
}

export default function ViewOnceEmbed({ 
  imageData, 
  imageType, 
  selfDestruct, 
  onClose 
}: ViewOnceEmbedProps) {
  const [timeRemaining, setTimeRemaining] = useState(selfDestruct || 0);
  const [imageError, setImageError] = useState(false);

  // Validate image data
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
      
      // Start countdown immediately with reduced first interval
      let currentTime = selfDestruct;
      
      const interval = setInterval(() => {
        currentTime -= 1;
        setTimeRemaining(currentTime);
        
        if (currentTime <= 0) {
          clearInterval(interval);
          // Wrap in setTimeout to avoid setState during render
          setTimeout(() => onClose(), 0);
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [selfDestruct, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full h-full flex flex-col items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all z-10 backdrop-blur-md"
          aria-label="Close"
        >
          <X className="w-6 h-6 text-white" />
        </button>

        {/* Timer display */}
        {selfDestruct && selfDestruct > 0 && timeRemaining > 0 && (
          <div className="absolute top-4 left-4 px-4 py-2 bg-red-500/90 rounded-full text-white text-sm font-semibold z-10 backdrop-blur-md animate-pulse">
            ⏱️ {timeRemaining}s
          </div>
        )}

        {/* Image */}
        {!imageError ? (
          <img
            src={`data:${imageType};base64,${imageData}`}
            alt="View once photo"
            className="max-w-[95%] max-h-[95%] object-contain rounded-lg shadow-2xl"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="text-white text-center">
            <p className="text-xl mb-4">❌ Failed to load image</p>
            <p className="text-sm text-neutral-400">Image data may be corrupted</p>
          </div>
        )}

        {/* Instruction text */}
        <p className="absolute bottom-4 text-neutral-400 text-sm">
          {selfDestruct && selfDestruct > 0 
            ? 'This photo will disappear automatically' 
            : 'Close when done viewing'}
        </p>
      </div>
    </div>
  );
}

'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSendMessage, onTyping, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
      onTyping(false);
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
    <form onSubmit={handleSubmit} className="border-t border-gray-800 p-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Type a message..."
          disabled={disabled}
          className="flex-1 bg-black border border-gray-800 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !message.trim()}
          className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </form>
  );
}

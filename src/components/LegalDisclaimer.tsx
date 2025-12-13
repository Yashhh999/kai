'use client';

import { useState, useEffect } from 'react';

export default function LegalDisclaimer() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem('legal_accepted');
    if (!accepted) {
      setShow(true);
    }
  }, []);

  const accept = () => {
    localStorage.setItem('legal_accepted', 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-neutral-900 border border-gray-800 rounded-lg p-6 max-w-md space-y-4">
        <h2 className="text-xl font-bold text-white">Before You Start</h2>
        
        <div className="space-y-3 text-sm text-gray-300">
          <p>By using Rooms, you agree:</p>
          
          <ul className="space-y-2 list-disc list-inside text-gray-400">
            <li>No illegal activities allowed</li>
            <li>No drug deals, weapons sales, or black market</li>
            <li>No harassment or illegal content</li>
            <li>You're 13+ years old</li>
            <li>You're responsible for your content</li>
          </ul>

          <p className="text-gray-500 text-xs pt-2">
            We can't read your messages (they're encrypted), but we cooperate with law enforcement when legally required.
          </p>

          <p className="text-gray-500 text-xs">
            This service is provided "as is" with no warranty. Messages may be lost. Don't use for critical communications.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={accept}
            className="flex-1 bg-white text-black py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            Accept & Continue
          </button>
          <a
            href="/"
            className="px-4 py-3 text-gray-400 hover:text-white border border-gray-800 rounded-lg transition-colors flex items-center"
          >
            Decline
          </a>
        </div>

        <div className="flex justify-center gap-4 text-xs text-gray-600">
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">
            Full Terms
          </a>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  );
}

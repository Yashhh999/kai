'use client';

import { useState, useEffect, useRef } from 'react';
import { Lock, Unlock } from 'lucide-react';

interface SessionLockProps {
  onUnlock: () => void;
}

export default function SessionLock({ onUnlock }: SessionLockProps) {
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Focus first input on mount
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    // Check lockout status
    if (lockoutUntil && Date.now() < lockoutUntil) {
      const timer = setInterval(() => {
        if (Date.now() >= lockoutUntil) {
          setLockoutUntil(null);
          setAttempts(0);
          setError('');
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [lockoutUntil]);

  const handlePinChange = (index: number, value: string) => {
    if (lockoutUntil && Date.now() < lockoutUntil) return;
    
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    setError('');

    // Auto-focus next input
    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
    if (newPin.every(digit => digit !== '') && index === 3) {
      verifyPin(newPin.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const verifyPin = (enteredPin: string) => {
    const storedPin = localStorage.getItem('session_pin');
    
    if (enteredPin === storedPin) {
      onUnlock();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setError(`Incorrect PIN (${newAttempts}/3 attempts)`);
      setPin(['', '', '', '']);
      inputRefs.current[0]?.focus();

      // Lockout after 3 failed attempts
      if (newAttempts >= 3) {
        const lockout = Date.now() + 30000; // 30 seconds
        setLockoutUntil(lockout);
        setError('Too many attempts. Locked for 30 seconds.');
      }
    }
  };

  const getRemainingTime = () => {
    if (!lockoutUntil) return 0;
    return Math.ceil((lockoutUntil - Date.now()) / 1000);
  };

  const isLockedOut = !!(lockoutUntil && Date.now() < lockoutUntil);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center backdrop-blur-md p-3 sm:p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-5 sm:p-6 md:p-8 max-w-md w-full shadow-2xl">
        <div className="flex flex-col items-center mb-5 sm:mb-6">
          <div className="bg-neutral-800 p-3 sm:p-4 rounded-full mb-3 sm:mb-4">
            <Lock className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">Session Locked</h2>
          <p className="text-neutral-400 text-xs sm:text-sm text-center">
            Enter your 4-digit PIN to unlock
          </p>
        </div>

        <div className="flex gap-2 sm:gap-3 justify-center mb-5 sm:mb-6">
          {pin.map((digit, index) => (
            <input
              key={index}
              ref={el => {
                inputRefs.current[index] = el;
              }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handlePinChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              disabled={isLockedOut}
              className={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 text-center text-xl sm:text-2xl font-bold rounded-lg border-2 
                ${isLockedOut 
                  ? 'bg-neutral-800 border-neutral-700 text-neutral-600 cursor-not-allowed' 
                  : 'bg-neutral-800 border-neutral-600 text-white focus:border-white focus:outline-none'
                } 
                ${error && !isLockedOut ? 'border-red-500' : ''}`}
            />
          ))}
        </div>

        {error && (
          <div className={`text-center mb-4 ${isLockedOut ? 'text-red-400' : 'text-red-500'}`}>
            <p className="text-sm">
              {isLockedOut 
                ? `Locked for ${getRemainingTime()}s` 
                : error}
            </p>
          </div>
        )}

        {isLockedOut && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
            <p className="text-red-400 text-xs">
              Wait {getRemainingTime()} seconds before trying again
            </p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-neutral-800">
          <p className="text-xs text-neutral-500 text-center">
            If you forgot your PIN, you'll need to clear your browser data
          </p>
        </div>
      </div>
    </div>
  );
}

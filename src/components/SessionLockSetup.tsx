'use client';

import { useState, useRef } from 'react';
import { Lock, X } from 'lucide-react';

interface SessionLockSetupProps {
  onComplete: (pin: string) => void;
  onCancel: () => void;
}

export default function SessionLockSetup({ onComplete, onCancel }: SessionLockSetupProps) {
  const [pin, setPin] = useState(['', '', '', '']);
  const [confirmPin, setConfirmPin] = useState(['', '', '', '']);
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handlePinChange = (index: number, value: string, isConfirm: boolean = false) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const currentPin = isConfirm ? confirmPin : pin;
    const setCurrentPin = isConfirm ? setConfirmPin : setPin;
    const refs = isConfirm ? confirmRefs : inputRefs;

    const newPin = [...currentPin];
    newPin[index] = value;
    setCurrentPin(newPin);
    setError('');

    // Auto-focus next input
    if (value && index < 3) {
      refs.current[index + 1]?.focus();
    }

    // Auto-proceed when all digits entered
    if (newPin.every(digit => digit !== '') && index === 3) {
      if (!isConfirm) {
        // Move to confirm step
        setStep('confirm');
        setTimeout(() => confirmRefs.current[0]?.focus(), 100);
      } else {
        // Verify match
        verifyPins(pin.join(''), newPin.join(''));
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent, isConfirm: boolean = false) => {
    const refs = isConfirm ? confirmRefs : inputRefs;
    const currentPin = isConfirm ? confirmPin : pin;
    
    if (e.key === 'Backspace' && !currentPin[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const verifyPins = (originalPin: string, confirmed: string) => {
    if (originalPin === confirmed) {
      localStorage.setItem('session_pin', originalPin);
      onComplete(originalPin);
    } else {
      setError('PINs do not match. Try again.');
      setPin(['', '', '', '']);
      setConfirmPin(['', '', '', '']);
      setStep('create');
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  };

  const handleBack = () => {
    setConfirmPin(['', '', '', '']);
    setStep('create');
    setError('');
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-neutral-800 p-3 rounded-full">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Setup Session Lock</h2>
              <p className="text-neutral-400 text-sm">
                {step === 'create' ? 'Create a 4-digit PIN' : 'Confirm your PIN'}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        {step === 'create' ? (
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-3">
              Enter PIN
            </label>
            <div className="flex gap-3 justify-center mb-6">
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
                  onChange={(e) => handlePinChange(index, e.target.value, false)}
                  onKeyDown={(e) => handleKeyDown(index, e, false)}
                  className="w-14 h-14 text-center text-2xl font-bold rounded-lg border-2 bg-neutral-800 border-neutral-600 text-white focus:border-white focus:outline-none"
                />
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-3">
              Confirm PIN
            </label>
            <div className="flex gap-3 justify-center mb-6">
              {confirmPin.map((digit, index) => (
                <input
                  key={index}
                  ref={el => {
                    confirmRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handlePinChange(index, e.target.value, true)}
                  onKeyDown={(e) => handleKeyDown(index, e, true)}
                  className={`w-14 h-14 text-center text-2xl font-bold rounded-lg border-2 bg-neutral-800 text-white focus:outline-none ${
                    error ? 'border-red-500' : 'border-neutral-600 focus:border-white'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={handleBack}
              className="w-full mb-4 py-2 text-sm text-neutral-400 hover:text-white transition-colors"
            >
              ← Back to create PIN
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}

        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <p className="text-blue-400 text-xs leading-relaxed">
            <strong>Note:</strong> Your PIN is stored locally in your browser. 
            If you forget it, you'll need to clear your browser data to reset it.
          </p>
        </div>
      </div>
    </div>
  );
}

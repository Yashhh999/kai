'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Socket } from 'socket.io-client';

interface RoomUser {
  id: string;
  name: string;
  lastSeen: number;
}

interface VoiceCallProps {
  roomCode: string;
  socket: Socket | null;
  users: RoomUser[];
  currentUserId: string;
  isConnected: boolean;
  onInitiateCall?: (fn: (user: RoomUser) => void) => void;
}

type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected';

export default function VoiceCall({ roomCode, socket, users, currentUserId, isConnected, onInitiateCall }: VoiceCallProps) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [remoteUser, setRemoteUser] = useState<{ id: string; name: string } | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'poor'>('excellent');
  
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const qualityCheckRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!remoteAudioRef.current) {
      remoteAudioRef.current = new Audio();
      remoteAudioRef.current.autoplay = true;
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleIncomingCall = ({ from, fromName }: { from: string; fromName: string }) => {
      if (callState !== 'idle') return;
      setRemoteUser({ id: from, name: fromName });
      setCallState('ringing');
      playRingtone();
    };

    const handleCallAccepted = ({ from }: { from: string }) => {
      if (callState === 'calling') {
        setCallState('connecting');
        setTimeout(() => startCall(from, true), 400);
      }
    };

    const handleCallRejected = () => endCall();
    const handleCallEnded = () => endCall();

    const handleVoiceSignal = async ({ from, signal }: { from: string; signal: any }) => {
      const pc = peerConnectionRef.current;
      if (!pc) return;

      try {
        if (signal.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('voice-call-signal', { to: from, signal: answer });
        } else if (signal.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
        } else if (signal.candidate?.sdpMid || signal.candidate?.sdpMLineIndex !== undefined) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (error) {
        console.error('Signal error:', error);
      }
    };

    socket.on('voice-call-incoming', handleIncomingCall);
    socket.on('voice-call-accepted', handleCallAccepted);
    socket.on('voice-call-rejected', handleCallRejected);
    socket.on('voice-call-ended', handleCallEnded);
    socket.on('voice-call-signal', handleVoiceSignal);

    return () => {
      socket.off('voice-call-incoming', handleIncomingCall);
      socket.off('voice-call-accepted', handleCallAccepted);
      socket.off('voice-call-rejected', handleCallRejected);
      socket.off('voice-call-ended', handleCallEnded);
      socket.off('voice-call-signal', handleVoiceSignal);
    };
  }, [socket, callState]);

  const playRingtone = () => {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
    
    setTimeout(() => {
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.setValueAtTime(330, audioContext.currentTime);
      gain2.gain.setValueAtTime(0.1, audioContext.currentTime);
      osc2.start(audioContext.currentTime);
      osc2.stop(audioContext.currentTime + 0.2);
    }, 400);
  };

  const checkConnectionQuality = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    try {
      const stats = await pc.getStats();
      let packetsLost = 0;
      let packetsReceived = 0;

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsLost = report.packetsLost || 0;
          packetsReceived = report.packetsReceived || 0;
        }
      });

      if (packetsReceived > 0) {
        const lossRate = packetsLost / (packetsLost + packetsReceived);
        if (lossRate > 0.05) setConnectionQuality('poor');
        else if (lossRate > 0.02) setConnectionQuality('good');
        else setConnectionQuality('excellent');
      }
    } catch (error) {
      console.error('Quality check error:', error);
    }
  }, []);

  const createPeerConnection = useCallback((remoteUserId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('voice-call-signal', {
          to: remoteUserId,
          signal: { candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteAudioRef.current && event.streams[0]) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.volume = 1.0;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected') {
        qualityCheckRef.current = setInterval(checkConnectionQuality, 3000);
      } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        endCall();
      }
    };

    return pc;
  }, [socket, checkConnectionQuality]);

  const startCall = async (targetUserId: string, isInitiator: boolean) => {
    try {
      setCallState('connected');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000
        }
      });
      localStreamRef.current = stream;

      const pc = createPeerConnection(targetUserId);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      if (isInitiator) {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true
        });
        await pc.setLocalDescription(offer);
        socket?.emit('voice-call-signal', { to: targetUserId, signal: offer });
      }
      
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Call start failed:', error);
      alert('Microphone access denied');
      endCall();
    }
  };

  const initiateCall = useCallback((user: RoomUser) => {
    if (!socket || !isConnected) return;
    setRemoteUser({ id: user.id, name: user.name });
    setCallState('calling');
    socket.emit('voice-call-request', { to: user.id, roomId: roomCode });
  }, [socket, isConnected, roomCode]);

  useEffect(() => {
    if (onInitiateCall) onInitiateCall(initiateCall);
  }, [onInitiateCall, initiateCall]);

  const acceptCall = () => {
    if (!remoteUser || !socket) return;
    setCallState('connecting');
    socket.emit('voice-call-accept', { to: remoteUser.id, roomId: roomCode });
    setTimeout(() => startCall(remoteUser.id, false), 250);
  };

  const rejectCall = () => {
    if (!remoteUser || !socket) return;
    socket.emit('voice-call-reject', { to: remoteUser.id });
    endCall();
  };

  const endCall = () => {
    if (callState === 'connected' && remoteUser && socket) {
      socket.emit('voice-call-end', { to: remoteUser.id });
    }

    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;

    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (qualityCheckRef.current) clearInterval(qualityCheckRef.current);

    setCallState('idle');
    setRemoteUser(null);
    setCallDuration(0);
    setIsMuted(false);
    setConnectionQuality('excellent');
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const qualityIndicator = {
    excellent: { color: 'bg-emerald-500', text: 'HD' },
    good: { color: 'bg-yellow-500', text: 'SD' },
    poor: { color: 'bg-red-500', text: 'Low' }
  }[connectionQuality];

  return (
    <>
      {callState === 'calling' && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-neutral-900/95 border border-neutral-800 rounded-2xl p-6 sm:p-8 max-w-sm w-full mx-4 shadow-2xl backdrop-blur-xl text-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-neutral-800 rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse">
              <svg className="w-8 h-8 sm:w-10 sm:h-10 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-white mb-1">Calling {remoteUser?.name}</h3>
            <p className="text-xs sm:text-sm text-neutral-500 mb-6">Waiting...</p>
            <div className="flex gap-1 justify-center mb-6">
              {[0, 150, 300].map((delay, i) => (
                <span key={i} className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: `${delay}ms` }}></span>
              ))}
            </div>
            <button onClick={endCall} className="w-full px-6 py-2.5 sm:py-3 bg-red-500 hover:bg-red-600 text-white text-sm sm:text-base rounded-xl font-medium transition-all active:scale-95">
              Cancel
            </button>
          </div>
        </div>
      )}

      {callState === 'ringing' && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-neutral-900/95 border border-neutral-800 rounded-2xl p-6 sm:p-8 max-w-sm w-full mx-4 shadow-2xl backdrop-blur-xl text-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-emerald-500/20 rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse">
              <svg className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-white mb-1">Incoming Call</h3>
            <p className="text-xs sm:text-sm text-neutral-400 mb-6">{remoteUser?.name}</p>
            <div className="flex gap-2 sm:gap-3">
              <button onClick={rejectCall} className="flex-1 px-4 sm:px-6 py-2.5 sm:py-3 bg-red-500 hover:bg-red-600 text-white text-sm sm:text-base rounded-xl font-medium transition-all active:scale-95">
                Decline
              </button>
              <button onClick={acceptCall} className="flex-1 px-4 sm:px-6 py-2.5 sm:py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm sm:text-base rounded-xl font-medium transition-all active:scale-95">
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {callState === 'connecting' && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-neutral-900/95 border border-neutral-800 rounded-2xl p-6 sm:p-8 max-w-sm w-full mx-4 shadow-2xl backdrop-blur-xl text-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-emerald-500/20 rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse">
              <svg className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-white mb-1">Call Accepted</h3>
            <p className="text-xs sm:text-sm text-neutral-500 mb-6">Connecting...</p>
            <div className="flex gap-1 justify-center">
              {[0, 150, 300].map((delay, i) => (
                <span key={i} className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: `${delay}ms` }}></span>
              ))}
            </div>
          </div>
        </div>
      )}

      {callState === 'connected' && (
        <div className="fixed top-16 sm:top-20 right-2 sm:right-4 bg-neutral-900/95 border border-neutral-800 rounded-2xl p-3 sm:p-4 shadow-2xl backdrop-blur-xl z-40 animate-in slide-in-from-top duration-200 max-w-[calc(100vw-1rem)] sm:max-w-none">
          <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-neutral-800 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs sm:text-sm font-medium text-white truncate">{remoteUser?.name}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${qualityIndicator.color} text-white font-medium`}>
                  {qualityIndicator.text}
                </span>
              </div>
              <p className="text-xs text-neutral-500">{formatDuration(callDuration)}</p>
            </div>
            <div className={`w-2 h-2 ${qualityIndicator.color} rounded-full animate-pulse flex-shrink-0`}></div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={toggleMute}
              className={`flex-1 p-2 sm:p-2.5 rounded-xl font-medium transition-all ${
                isMuted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-neutral-800 text-white hover:bg-neutral-700'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isMuted ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                )}
              </svg>
            </button>
            <button onClick={endCall} className="flex-1 p-2 sm:p-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-all active:scale-95" title="End call">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

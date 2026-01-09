'use client';

import { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Socket } from 'socket.io-client';

interface VoiceParticipant {
  userId: string;
  username: string;
  isMuted: boolean;
  isDeafened: boolean;
  joinedAt: number;
  lastActivity: number;
}

interface VoiceChannelProps {
  roomCode: string;
  socket: Socket | null;
  currentUserId: string;
  currentUsername: string;
  isConnected: boolean;
  onVoiceStateChange?: (isInVoice: boolean, participantCount: number) => void;
}

export interface VoiceChannelRef {
  toggle: () => void;
  isInVoice: boolean;
  participantCount: number;
}

const VoiceChannel = forwardRef<VoiceChannelRef, VoiceChannelProps>(({
  roomCode,
  socket,
  currentUserId,
  currentUsername,
  isConnected,
  onVoiceStateChange
}, ref) => {
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [inVoice, setInVoice] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectionStatus, setConnectionStatus] = useState<Map<string, 'connecting' | 'connected' | 'failed'>>(new Map());
  const [channelStartTime, setChannelStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const [micError, setMicError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidate[]>>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);
  const connectionAttempts = useRef<Map<string, number>>(new Map());
  const isJoiningRef = useRef(false);
  const inVoiceRef = useRef(false); // Ref to track voice state immediately

  // Keep ref in sync with state
  useEffect(() => {
    inVoiceRef.current = inVoice;
  }, [inVoice]);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    toggle: () => setIsOpen(prev => !prev),
    isInVoice: inVoice,
    participantCount: participants.length
  }), [inVoice, participants.length]);

  // Notify parent of voice state changes
  useEffect(() => {
    onVoiceStateChange?.(inVoice, participants.length);
  }, [inVoice, participants.length, onVoiceStateChange]);

  // Initialize position
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPosition({ x: 16, y: window.innerHeight - 450 });
    }
  }, []);

  // Timer for elapsed time
  useEffect(() => {
    if (!channelStartTime) {
      setElapsedTime('00:00');
      return;
    }

    const updateTime = () => {
      const seconds = Math.floor((Date.now() - channelStartTime) / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      setElapsedTime(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [channelStartTime]);

  // Cleanup on unmount ONLY (not on dependency changes)
  useEffect(() => {
    const cleanup = () => {
      console.log('[Voice] Unmount cleanup triggered');
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      peersRef.current.forEach(peer => peer.close());
      peersRef.current.clear();
      remoteAudiosRef.current.forEach(audio => {
        audio.pause();
        audio.srcObject = null;
      });
      remoteAudiosRef.current.clear();
      pendingCandidatesRef.current.clear();
      connectionAttempts.current.clear();
    };

    const handleBeforeUnload = () => {
      if (inVoiceRef.current) {
        // Can't reliably emit in beforeunload, but try anyway
        cleanup();
      }
    };

    // Cleanup on page unload
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Only emit voice-leave if we're actually in voice when unmounting
      if (inVoiceRef.current) {
        socket?.emit('voice-leave', { roomId: roomCode });
      }
      cleanup();
    };
    // Empty dependency array - only run on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    const handleVoiceStateUpdate = (updatedParticipants: VoiceParticipant[]) => {
      console.log('[Voice] State update:', updatedParticipants.length, 'participants', updatedParticipants.map(p => p.username));
      console.log('[Voice] inVoiceRef:', inVoiceRef.current, 'isJoiningRef:', isJoiningRef.current, 'localStream:', !!localStreamRef.current);
      setParticipants(updatedParticipants);

      // Set channel start time
      if (updatedParticipants.length > 0 && !channelStartTime) {
        const earliestJoin = Math.min(...updatedParticipants.map(p => p.joinedAt));
        setChannelStartTime(earliestJoin);
      } else if (updatedParticipants.length === 0) {
        setChannelStartTime(null);
      }

      // Check if we were kicked (our userId no longer in participants but we think we're in voice)
      const meInParticipants = updatedParticipants.some(p => p.userId === currentUserId);
      if (inVoiceRef.current && !meInParticipants && !isJoiningRef.current) {
        console.log('[Voice] We were removed from voice channel');
        cleanupVoice();
        return;
      }

      // Only process peer connections if we're in voice (use ref for immediate state)
      if (!inVoiceRef.current || !localStreamRef.current) {
        console.log('[Voice] Not in voice or no local stream, skipping peer creation');
        return;
      }

      const otherParticipants = updatedParticipants.filter(p => p.userId !== currentUserId);
      const currentParticipantIds = new Set(otherParticipants.map(p => p.userId));

      // Clean up peers that left
      peersRef.current.forEach((peer, odId) => {
        if (!currentParticipantIds.has(odId)) {
          console.log(`[Voice] Peer left: ${odId}`);
          peer.close();
          peersRef.current.delete(odId);
          cleanupRemoteAudio(odId);
          setConnectionStatus(prev => {
            const newMap = new Map(prev);
            newMap.delete(odId);
            return newMap;
          });
        }
      });

      // Create peer connections for new participants (only if we should initiate)
      otherParticipants.forEach(participant => {
        if (!peersRef.current.has(participant.userId)) {
          // Use deterministic initiator selection - lower ID initiates
          const shouldInitiate = currentUserId < participant.userId;
          console.log(`[Voice] New peer: ${participant.username}, shouldInitiate: ${shouldInitiate}`);
          
          setConnectionStatus(prev => new Map(prev).set(participant.userId, 'connecting'));
          
          setTimeout(() => {
            if (inVoiceRef.current && localStreamRef.current && !peersRef.current.has(participant.userId)) {
              createPeerConnection(participant.userId, shouldInitiate);
            } else {
              console.log(`[Voice] Skipped creating peer for ${participant.username}: inVoice=${inVoiceRef.current}, stream=${!!localStreamRef.current}, exists=${peersRef.current.has(participant.userId)}`);
            }
          }, shouldInitiate ? 100 : 500);
        }
      });
    };

    const handleVoiceSignal = async ({ from, signal }: { from: string; signal: any }) => {
      if (from === currentUserId) return;
      
      console.log(`[Voice] Signal from ${from}:`, signal.type || 'candidate');

      // If we're not in voice, ignore signals (use ref for immediate state)
      if (!inVoiceRef.current && !isJoiningRef.current) {
        console.log('[Voice] Not in voice, ignoring signal');
        return;
      }

      let pc = peersRef.current.get(from);

      // Handle incoming offer - create peer if doesn't exist
      if (signal.type === 'offer') {
        if (pc) {
          // Close existing connection and create new one
          console.log('[Voice] Received offer but already have PC, recreating...');
          pc.close();
          peersRef.current.delete(from);
        }
        console.log(`[Voice] Creating peer for incoming offer from ${from}`);
        setConnectionStatus(prev => new Map(prev).set(from, 'connecting'));
        pc = createPeerConnection(from, false);
      }

      if (!pc) {
        console.log(`[Voice] No peer for ${from}, creating one...`);
        setConnectionStatus(prev => new Map(prev).set(from, 'connecting'));
        pc = createPeerConnection(from, false);
      }

      try {
        if (signal.type === 'offer') {
          console.log(`[Voice] Setting remote offer from ${from}`);
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          await processPendingCandidates(from, pc);
          
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          socket.emit('voice-signal', { roomId: roomCode, targetId: from, signal: pc.localDescription });
          console.log(`[Voice] Sent answer to ${from}`);
          
        } else if (signal.type === 'answer') {
          console.log(`[Voice] Setting remote answer from ${from}, state: ${pc.signalingState}`);
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            await processPendingCandidates(from, pc);
            console.log(`[Voice] Answer applied from ${from}`);
          }
          
        } else if (signal.candidate) {
          console.log(`[Voice] Adding ICE candidate from ${from}`);
          const candidate = new RTCIceCandidate(signal.candidate);
          
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(candidate);
          } else {
            // Queue candidate
            if (!pendingCandidatesRef.current.has(from)) {
              pendingCandidatesRef.current.set(from, []);
            }
            pendingCandidatesRef.current.get(from)!.push(candidate);
            console.log(`[Voice] Queued candidate for ${from}`);
          }
        }
      } catch (error) {
        console.error(`[Voice] Signal error for ${from}:`, error);
      }
    };

    const handleVoiceKicked = () => {
      console.log('[Voice] Kicked from voice channel');
      cleanupVoice();
      alert('You were kicked from voice channel due to inactivity');
    };

    const handleDisconnect = () => {
      console.log('[Voice] Socket disconnected');
      if (inVoice) {
        cleanupVoice();
      }
    };

    socket.on('voice-state-update', handleVoiceStateUpdate);
    socket.on('voice-signal', handleVoiceSignal);
    socket.on('voice-kicked-afk', handleVoiceKicked);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('voice-state-update', handleVoiceStateUpdate);
      socket.off('voice-signal', handleVoiceSignal);
      socket.off('voice-kicked-afk', handleVoiceKicked);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket, currentUserId, roomCode, inVoice, channelStartTime]);

  const processPendingCandidates = async (odId: string, pc: RTCPeerConnection) => {
    const candidates = pendingCandidatesRef.current.get(odId);
    if (candidates && candidates.length > 0) {
      console.log(`[Voice] Processing ${candidates.length} pending candidates for ${odId}`);
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (e) {
          console.error('[Voice] Failed to add pending candidate:', e);
        }
      }
      pendingCandidatesRef.current.delete(odId);
    }
  };

  const cleanupRemoteAudio = (odId: string) => {
    const audio = remoteAudiosRef.current.get(odId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      remoteAudiosRef.current.delete(odId);
    }
  };

  const cleanupVoice = useCallback(() => {
    console.log('[Voice] Cleaning up voice state');
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    peersRef.current.forEach((peer, odId) => {
      peer.close();
      cleanupRemoteAudio(odId);
    });
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    connectionAttempts.current.clear();

    remoteAudiosRef.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
    });
    remoteAudiosRef.current.clear();

    inVoiceRef.current = false;
    setInVoice(false);
    setIsMuted(false);
    setIsDeafened(false);
    setConnectionStatus(new Map());
    setMicError(null);
    isJoiningRef.current = false;
  }, []);

  const createPeerConnection = useCallback((odId: string, isInitiator: boolean): RTCPeerConnection => {
    console.log(`[Voice] Creating PC for ${odId}, initiator: ${isInitiator}`);

    // Close existing connection if any
    const existingPc = peersRef.current.get(odId);
    if (existingPc) {
      console.log(`[Voice] Closing existing PC for ${odId}`);
      existingPc.close();
      peersRef.current.delete(odId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Free TURN servers from Open Relay Project
        {
          urls: 'turn:relay1.expressturn.com:3478',
          username: 'efWXHN45WUJVS85RZH',
          credential: 'N8SxmFVCQZ46mQVg'
        },
        // Fallback TURN servers
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all'
    });

    // Add local tracks FIRST before creating offer
    if (localStreamRef.current) {
      console.log(`[Voice] Adding ${localStreamRef.current.getTracks().length} local tracks`);
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    } else {
      console.error('[Voice] No local stream when creating PC!');
    }

    // Send ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[Voice] Sending ICE candidate to ${odId}`);
        socket?.emit('voice-signal', {
          roomId: roomCode,
          targetId: odId,
          signal: { candidate: event.candidate.toJSON() }
        });
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[Voice] ICE gathering state for ${odId}:`, pc.iceGatheringState);
    };

    // Handle incoming audio track
    pc.ontrack = (event) => {
      console.log(`[Voice] *** Received audio track from ${odId} ***`);
      
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        console.log(`[Voice] Stream has ${stream.getTracks().length} tracks`);
        
        // Create or get audio element
        let audio = remoteAudiosRef.current.get(odId);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          remoteAudiosRef.current.set(odId, audio);
          console.log(`[Voice] Created audio element for ${odId}`);
        }
        
        audio.srcObject = stream;
        audio.volume = isDeafened ? 0 : 1;
        
        // Try to play (may fail due to autoplay policy)
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log(`[Voice] Audio playing for ${odId}`);
              setConnectionStatus(prev => new Map(prev).set(odId, 'connected'));
            })
            .catch(e => {
              console.error(`[Voice] Audio play failed for ${odId}:`, e);
              // Try again on user interaction
              const resumeAudio = () => {
                audio?.play().catch(console.error);
                document.removeEventListener('click', resumeAudio);
              };
              document.addEventListener('click', resumeAudio, { once: true });
            });
        }
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log(`[Voice] Connection state for ${odId}:`, pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        setConnectionStatus(prev => new Map(prev).set(odId, 'connected'));
        connectionAttempts.current.set(odId, 0);
      } else if (pc.connectionState === 'failed') {
        const attempts = connectionAttempts.current.get(odId) || 0;
        if (attempts < 3) {
          console.log(`[Voice] Retrying connection to ${odId}, attempt ${attempts + 1}`);
          connectionAttempts.current.set(odId, attempts + 1);
          
          // Try ICE restart first
          if (attempts === 0 && pc.restartIce) {
            console.log(`[Voice] Attempting ICE restart for ${odId}`);
            pc.restartIce();
            pc.createOffer({ iceRestart: true })
              .then(offer => pc.setLocalDescription(offer))
              .then(() => {
                socket?.emit('voice-signal', { 
                  roomId: roomCode, 
                  targetId: odId, 
                  signal: pc.localDescription 
                });
              })
              .catch(err => console.error('[Voice] ICE restart error:', err));
          } else {
            // Recreate the connection
            setTimeout(() => {
              if (peersRef.current.has(odId)) {
                peersRef.current.get(odId)?.close();
                peersRef.current.delete(odId);
              }
              if (localStreamRef.current) {
                createPeerConnection(odId, true);
              }
            }, 1000 * (attempts + 1));
          }
        } else {
          setConnectionStatus(prev => new Map(prev).set(odId, 'failed'));
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Voice] ICE connection state for ${odId}:`, pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setConnectionStatus(prev => new Map(prev).set(odId, 'connected'));
      } else if (pc.iceConnectionState === 'checking') {
        setConnectionStatus(prev => new Map(prev).set(odId, 'connecting'));
      } else if (pc.iceConnectionState === 'disconnected') {
        // Give it time to recover before showing as reconnecting
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            setConnectionStatus(prev => new Map(prev).set(odId, 'connecting'));
          }
        }, 2000);
      } else if (pc.iceConnectionState === 'failed') {
        // Trigger connection state change handler
        console.log(`[Voice] ICE failed for ${odId}, will trigger retry`);
      }
    };

    peersRef.current.set(odId, pc);

    // Create offer if initiator - wait a short moment to ensure tracks are added
    if (isInitiator) {
      setTimeout(() => {
        console.log(`[Voice] Creating offer for ${odId}`);
        pc.createOffer({ offerToReceiveAudio: true })
          .then(offer => {
            console.log(`[Voice] Setting local description for ${odId}`);
            return pc.setLocalDescription(offer);
          })
          .then(() => {
            console.log(`[Voice] Sending offer to ${odId}`);
            socket?.emit('voice-signal', { 
              roomId: roomCode, 
              targetId: odId, 
              signal: pc.localDescription 
            });
          })
          .catch(err => console.error('[Voice] Offer error:', err));
      }, 50); // Small delay to ensure tracks are ready
    }

    return pc;
  }, [socket, roomCode, isDeafened]);

  const joinVoice = async () => {
    if (inVoice || isJoiningRef.current) return;
    
    isJoiningRef.current = true;
    setMicError(null);

    try {
      console.log('[Voice] Requesting microphone...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1
        }
      });

      console.log('[Voice] Microphone granted, tracks:', stream.getAudioTracks().length);
      
      // Verify we got an audio track
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('No audio track received');
      }
      
      console.log('[Voice] Audio track settings:', audioTrack.getSettings());
      
      localStreamRef.current = stream;
      
      // Set the ref BEFORE the state to ensure handlers see it immediately
      inVoiceRef.current = true;
      setInVoice(true);
      setIsMuted(false);
      setIsDeafened(false);

      // Notify server
      socket?.emit('voice-join', { roomId: roomCode });
      console.log('[Voice] Sent voice-join to server');
      
    } catch (error: unknown) {
      console.error('[Voice] Microphone error:', error);
      isJoiningRef.current = false;
      inVoiceRef.current = false;
      
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          setMicError('Microphone access denied. Please allow microphone access in your browser settings.');
        } else if (error.name === 'NotFoundError') {
          setMicError('No microphone found. Please connect a microphone.');
        } else if (error.name === 'NotReadableError') {
          setMicError('Microphone is in use by another application.');
        } else {
          setMicError(`Microphone error: ${error.message}`);
        }
      }
    } finally {
      isJoiningRef.current = false;
    }
  };

  const leaveVoice = useCallback(() => {
    console.log('[Voice] Leaving voice channel');
    
    socket?.emit('voice-leave', { roomId: roomCode });
    cleanupVoice();
  }, [socket, roomCode, cleanupVoice]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;

    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      const newMuted = !isMuted;
      audioTrack.enabled = !newMuted;
      setIsMuted(newMuted);
      socket?.emit('voice-toggle-mute', { roomId: roomCode });
      console.log('[Voice] Mute toggled:', newMuted);
    }
  }, [isMuted, socket, roomCode]);

  const toggleDeafen = useCallback(() => {
    const newDeafened = !isDeafened;
    setIsDeafened(newDeafened);

    // Mute/unmute all remote audio
    remoteAudiosRef.current.forEach((audio, odId) => {
      audio.volume = newDeafened ? 0 : 1;
      console.log(`[Voice] Set volume for ${odId}:`, audio.volume);
    });

    // Also mute yourself when deafened
    if (newDeafened && localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
        setIsMuted(true);
      }
    }

    socket?.emit('voice-toggle-deafen', { roomId: roomCode });
    console.log('[Voice] Deafen toggled:', newDeafened);
  }, [isDeafened, socket, roomCode]);

  // Dragging handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 320, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 400, e.clientY - dragOffset.y))
      });
    }
  }, [isDragging, dragOffset]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Get participant data
  const myParticipant = participants.find(p => p.userId === currentUserId);
  const otherParticipants = participants.filter(p => p.userId !== currentUserId);
  const isVoiceActive = participants.length > 0;

  // Connection summary
  const connectedCount = Array.from(connectionStatus.values()).filter(s => s === 'connected').length;
  const connectingCount = Array.from(connectionStatus.values()).filter(s => s === 'connecting').length;

  return (
    <>
      {isOpen && (
        <div
          ref={panelRef}
          className="fixed z-50 w-80 bg-black/95 border border-neutral-800 rounded-2xl backdrop-blur-2xl shadow-2xl overflow-hidden"
          style={{ left: `${position.x}px`, top: `${position.y}px`, cursor: isDragging ? 'grabbing' : 'default' }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 border-b border-neutral-800 bg-neutral-900/50 flex items-center gap-3 cursor-move select-none"
            onMouseDown={handleMouseDown}
          >
            <div className="relative">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isVoiceActive ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-neutral-800 border border-neutral-700'}`}>
                <svg className={`w-5 h-5 ${isVoiceActive ? 'text-emerald-400' : 'text-neutral-500'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              {isVoiceActive && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full text-[10px] flex items-center justify-center text-black font-bold shadow-lg animate-pulse">
                  {participants.length}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">Voice Channel</p>
              <p className="text-xs text-neutral-500">
                {isVoiceActive ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                    {elapsedTime} · {participants.length} {participants.length === 1 ? 'user' : 'users'}
                  </span>
                ) : (
                  'No one in voice'
                )}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-neutral-800 rounded-lg transition-all"
            >
              <svg className="w-4 h-4 text-neutral-500 hover:text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Connection Status Banner */}
          {inVoice && otherParticipants.length > 0 && (
            <div className="px-4 py-2 bg-neutral-900/50 border-b border-neutral-800 text-xs">
              {connectingCount > 0 && connectedCount === 0 && (
                <span className="text-yellow-400 flex items-center gap-2">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Connecting to {connectingCount} {connectingCount === 1 ? 'user' : 'users'}...
                </span>
              )}
              {connectedCount > 0 && (
                <span className="text-emerald-400 flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                  Connected to {connectedCount} of {otherParticipants.length}
                </span>
              )}
            </div>
          )}

          {/* Participants List */}
          <div className="max-h-64 overflow-y-auto p-3 space-y-1.5">
            {/* Your own entry when in voice */}
            {inVoice && (
              <div className="flex items-center gap-3 p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <div className="relative">
                  <div className="w-9 h-9 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                    <span className="text-sm font-bold text-emerald-400">
                      {currentUsername.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-black shadow-lg"></div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{currentUsername}</p>
                  <p className="text-[10px] text-emerald-400 font-medium uppercase tracking-wide flex items-center gap-1">
                    <span className="w-1 h-1 bg-emerald-400 rounded-full animate-pulse"></span>
                    You · In Voice
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {isDeafened ? (
                    <div className="p-1.5 bg-red-500/20 rounded-lg" title="Deafened">
                      <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                      </svg>
                    </div>
                  ) : isMuted ? (
                    <div className="p-1.5 bg-red-500/20 rounded-lg" title="Muted">
                      <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                      </svg>
                    </div>
                  ) : (
                    <div className="flex gap-0.5 items-end h-5">
                      <span className="w-1 bg-emerald-400 rounded-full animate-pulse" style={{ height: '40%' }}></span>
                      <span className="w-1 bg-emerald-400 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '100ms' }}></span>
                      <span className="w-1 bg-emerald-400 rounded-full animate-pulse" style={{ height: '60%', animationDelay: '200ms' }}></span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Other participants */}
            {otherParticipants.map(participant => {
              const status = inVoice ? (connectionStatus.get(participant.userId) || 'connecting') : 'connected';
              return (
                <div key={participant.userId} className="flex items-center gap-3 p-3 hover:bg-neutral-900/50 rounded-xl transition-all">
                  <div className="relative">
                    <div className="w-9 h-9 bg-neutral-800 rounded-lg flex items-center justify-center border border-neutral-700">
                      <span className="text-sm font-bold text-neutral-400">
                        {participant.username.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    {status === 'connecting' ? (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3" title="Connecting...">
                        <svg className="animate-spin text-yellow-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      </div>
                    ) : status === 'connected' ? (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-black shadow-lg" title="Connected"></div>
                    ) : (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-black" title="Connection failed"></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-neutral-200 truncate">{participant.username}</p>
                    <p className={`text-[10px] font-medium uppercase tracking-wide ${
                      status === 'connected' ? 'text-emerald-500' : 
                      status === 'failed' ? 'text-red-400' : 'text-yellow-500'
                    }`}>
                      {inVoice ? (status === 'connected' ? 'Connected' : status === 'failed' ? 'Failed' : 'Connecting...') : 'In Voice'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {participant.isDeafened ? (
                      <div className="p-1.5 bg-red-500/20 rounded-lg">
                        <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                        </svg>
                      </div>
                    ) : participant.isMuted ? (
                      <div className="p-1.5 bg-red-500/20 rounded-lg">
                        <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                        </svg>
                      </div>
                    ) : status === 'connected' || !inVoice ? (
                      <div className="flex gap-0.5 items-end h-5">
                        <span className="w-1 bg-emerald-400 rounded-full animate-pulse" style={{ height: '40%' }}></span>
                        <span className="w-1 bg-emerald-400 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '100ms' }}></span>
                        <span className="w-1 bg-emerald-400 rounded-full animate-pulse" style={{ height: '60%', animationDelay: '200ms' }}></span>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {participants.length === 0 && (
              <div className="text-center py-8">
                <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                  <svg className="w-7 h-7 text-neutral-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <p className="text-sm text-neutral-500 font-medium">No one in voice</p>
                <p className="text-xs text-neutral-600 mt-1">Click below to start</p>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="p-3 border-t border-neutral-800 bg-neutral-900/50">
            {micError && (
              <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400">{micError}</p>
              </div>
            )}

            {!inVoice ? (
              <button
                onClick={joinVoice}
                disabled={!isConnected}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-black font-bold rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:shadow-none"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Join Voice
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={toggleMute}
                    className={`flex-1 p-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
                      isMuted 
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                        : 'bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700'
                    }`}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      {isMuted ? (
                        <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                      ) : (
                        <>
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                        </>
                      )}
                    </svg>
                    <span className="text-sm">{isMuted ? 'Unmute' : 'Mute'}</span>
                  </button>
                  <button
                    onClick={toggleDeafen}
                    className={`flex-1 p-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
                      isDeafened 
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                        : 'bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700'
                    }`}
                    title={isDeafened ? 'Undeafen' : 'Deafen'}
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      {isDeafened ? (
                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                      ) : (
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                      )}
                    </svg>
                    <span className="text-sm">{isDeafened ? 'Undeafen' : 'Deafen'}</span>
                  </button>
                </div>
                <button
                  onClick={leaveVoice}
                  className="w-full py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl font-bold transition-all active:scale-[0.98] border border-red-500/30"
                >
                  Leave Voice
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
});

VoiceChannel.displayName = 'VoiceChannel';

export default VoiceChannel;

export interface Message {
  id: string;
  content: string;
  senderId: string;
  senderName: string;
  timestamp: number;
  isSent: boolean;
  editedAt?: number;
  originalContent?: string;
}

export interface RoomStorage {
  roomCode: string;
  messages: Message[];
  createdAt: number;
  expiresAt: number;
  extendedRetention: boolean;
}

export interface UserPreferences {
  username: string;
  extendedRetention: boolean;
}

const STORAGE_KEY_PREFIX = 'room_';
const USER_PREFS_KEY = 'user_prefs';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_WEEKS_MS = 7 * 7 * ONE_DAY_MS;

export const getUserPreferences = (): UserPreferences => {
  const stored = localStorage.getItem(USER_PREFS_KEY);
  if (stored) {
    return JSON.parse(stored);
  }
  return { username: '', extendedRetention: false };
};

export const saveUserPreferences = (prefs: UserPreferences): void => {
  localStorage.setItem(USER_PREFS_KEY, JSON.stringify(prefs));
};

export const saveRoomData = (roomCode: string, messages: Message[], extendedRetention = false): void => {
  const now = Date.now();
  const retention = extendedRetention ? SEVEN_WEEKS_MS : ONE_DAY_MS;
  const data: RoomStorage = {
    roomCode,
    messages,
    createdAt: now,
    expiresAt: now + retention,
    extendedRetention,
  };
  
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${roomCode}`, JSON.stringify(data));
  } catch (error) {
    console.error('Storage save failed:', error);
  }
};

export const deleteRoomData = (roomCode: string): void => {
  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${roomCode}`);
  } catch (error) {
    console.error('Storage delete failed:', error);
  }
};

export const loadRoomData = (roomCode: string): RoomStorage | null => {
  try {
    const data = localStorage.getItem(`${STORAGE_KEY_PREFIX}${roomCode}`);
    if (!data) return null;

    const parsed: RoomStorage = JSON.parse(data);
    
    if (Date.now() > parsed.expiresAt) {
      deleteRoomData(roomCode);
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('Storage load failed:', error);
    return null;
  }
};

export const cleanupExpiredRooms = (): void => {
  try {
    const keys = Object.keys(localStorage);
    const now = Date.now();

    keys.forEach((key) => {
      if (key.startsWith(STORAGE_KEY_PREFIX)) {
        const data = localStorage.getItem(key);
        if (data) {
          const parsed: RoomStorage = JSON.parse(data);
          if (now > parsed.expiresAt) {
            localStorage.removeItem(key);
          }
        }
      }
    });
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
};

export const getAllStoredRooms = (): string[] => {
  try {
    const keys = Object.keys(localStorage);
    const roomCodes: string[] = [];

    keys.forEach((key) => {
      if (key.startsWith(STORAGE_KEY_PREFIX)) {
        const roomCode = key.replace(STORAGE_KEY_PREFIX, '');
        const data = loadRoomData(roomCode);
        if (data) {
          roomCodes.push(roomCode);
        }
      }
    });

    return roomCodes;
  } catch (error) {
    console.error('Get rooms failed:', error);
    return [];
  }
};
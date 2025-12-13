export const generateRoomCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const array = new Uint32Array(16);
  crypto.getRandomValues(array);
  
  for (let i = 0; i < 16; i++) {
    code += chars[array[i] % chars.length];
  }
  
  return code;
};

export const formatRoomCode = (code: string): string => {
  return code.match(/.{1,4}/g)?.join('-') || code;
};

export const isValidRoomCode = (code: string): boolean => {
  const cleanCode = code.replace(/-/g, '');
  return /^[A-Z0-9]{16}$/.test(cleanCode);
};

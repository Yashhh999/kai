import imageCompression from 'browser-image-compression';

export interface FileData {
  name: string;
  size: number;
  type: string;
  data: string;
  thumbnail?: string;
}

const MAX_DIRECT_SIZE = 10 * 1024 * 1024; // 10MB

export const isFileTooLarge = (size: number): boolean => {
  return size > MAX_DIRECT_SIZE;
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

export const getFileIcon = (type: string): string => {
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎥';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('pdf')) return '📄';
  if (type.includes('word') || type.includes('document')) return '📝';
  if (type.includes('sheet') || type.includes('excel')) return '📊';
  if (type.includes('zip') || type.includes('rar')) return '📦';
  return '📎';
};

export const compressImage = async (file: File): Promise<File> => {
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
  };
  
  try {
    return await imageCompression(file, options);
  } catch (error) {
    console.error('Compression failed:', error);
    return file;
  }
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const base64ToBlob = (base64: string): Blob => {
  const arr = base64.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

export const createThumbnail = async (file: File): Promise<string | undefined> => {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    return undefined;
  }

  if (file.type.startsWith('image/')) {
    const options = {
      maxSizeMB: 0.1,
      maxWidthOrHeight: 200,
      useWebWorker: true,
    };
    
    try {
      const compressed = await imageCompression(file, options);
      return await fileToBase64(compressed);
    } catch {
      return undefined;
    }
  }

  return undefined;
};

export const prepareFile = async (file: File): Promise<FileData> => {
  let processedFile = file;
  
  if (file.type.startsWith('image/') && file.size > 2 * 1024 * 1024) {
    processedFile = await compressImage(file);
  }

  const data = await fileToBase64(processedFile);
  const thumbnail = await createThumbnail(processedFile);

  return {
    name: file.name,
    size: processedFile.size,
    type: file.type,
    data,
    thumbnail,
  };
};

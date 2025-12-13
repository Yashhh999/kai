export const performanceMonitor = {
  measureTime: (label: string, fn: () => void) => {
    const start = performance.now();
    fn();
    const end = performance.now();
    if (end - start > 100) {
      console.warn(`Performance: ${label} took ${(end - start).toFixed(2)}ms`);
    }
  },

  measureAsync: async (label: string, fn: () => Promise<void>) => {
    const start = performance.now();
    await fn();
    const end = performance.now();
    if (end - start > 100) {
      console.warn(`Performance: ${label} took ${(end - start).toFixed(2)}ms`);
    }
  },

  debounce: <T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },

  throttle: <T extends (...args: any[]) => any>(
    func: T,
    limit: number
  ): ((...args: Parameters<T>) => void) => {
    let inThrottle: boolean = false;
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },
};

export const checkMemoryUsage = () => {
  if ('memory' in performance) {
    const memory = (performance as any).memory;
    const usedMB = memory.usedJSHeapSize / 1048576;
    const totalMB = memory.jsHeapSizeLimit / 1048576;
    const percentage = (usedMB / totalMB) * 100;
    
    if (percentage > 80) {
      console.warn(`Memory usage high: ${usedMB.toFixed(2)}MB / ${totalMB.toFixed(2)}MB (${percentage.toFixed(1)}%)`);
    }
  }
};

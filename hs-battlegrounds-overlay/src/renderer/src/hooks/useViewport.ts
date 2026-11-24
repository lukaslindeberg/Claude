import { useEffect, useState } from 'react';

export interface Viewport {
  width: number;
  height: number;
}

function read(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

/** Re-render every `ms` milliseconds (for "N turns ago"/timers). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

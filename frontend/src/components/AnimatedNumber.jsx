import { useEffect, useRef, useState } from 'react';

export default function AnimatedNumber({ value, className = '' }) {
  const [display, setDisplay] = useState(value);
  const [popping, setPopping] = useState(false);
  const prevRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === value) return;
    prevRef.current = value;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const start = prev;
    const end = value;
    const duration = 600;
    const startTime = performance.now();

    setPopping(true);
    setTimeout(() => setPopping(false), 400);

    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);

  return (
    <span className={`${className} inline-block transition-colors ${popping ? 'animate-num-pop' : ''}`}>
      {display}
    </span>
  );
}

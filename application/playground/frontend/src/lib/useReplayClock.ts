import { useEffect, useRef, useState } from "react";

export function replayPosition(elapsedMs: number, durationMs: number, eventCount: number) {
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return {
    progress,
    // First event is visible immediately; every event gets an equal time slot.
    revealedCount: Math.min(eventCount, Math.max(1, Math.floor(progress * eventCount) + 1)),
  };
}

/** One monotonic deadline, with all callbacks removed on stop or navigation. */
export function useReplayClock(running: boolean, duration: number, eventCount: number, onComplete: () => void) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    setElapsedMs(0);
    if (!running) return;
    const startedAt = performance.now();
    const durationMs = duration * 1000;
    let cancelled = false;
    let completed = false;
    let timer: number;
    const tick = () => {
      if (cancelled || completed) return;
      const elapsed = Math.max(0, performance.now() - startedAt);
      setElapsedMs(Math.min(durationMs, elapsed));
      if (elapsed >= durationMs) {
        completed = true;
        completeRef.current();
        return;
      }
      timer = window.setTimeout(tick, Math.min(50, durationMs - elapsed));
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [running, duration, eventCount]);

  return { elapsedMs, ...replayPosition(elapsedMs, duration * 1000, eventCount) };
}

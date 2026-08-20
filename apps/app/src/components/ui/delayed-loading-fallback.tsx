import { useEffect, useState, type ReactNode } from "react";

/** Keep fast loading states from flashing a placeholder for a single frame. */
export const LOADING_FALLBACK_REVEAL_DELAY_MS = 200;

export function DelayedLoadingFallback({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setVisible(true),
      LOADING_FALLBACK_REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, []);

  return visible ? children : null;
}

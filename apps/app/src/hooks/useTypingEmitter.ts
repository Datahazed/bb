import { useEffect, useRef } from "react";
import { wsManager } from "@/lib/ws";

// The server expires a typing claim after 6s; refresh at 2.5s so a steady
// typist never flickers, and drop the claim after a short idle pause so a
// parked non-empty draft doesn't read as active typing.
const TYPING_REFRESH_MS = 2_500;
const TYPING_IDLE_TIMEOUT_MS = 4_000;

interface UseTypingEmitterArgs {
  threadId: string;
  /** Current composer draft text; edits to it are what count as typing. */
  draftText: string;
  enabled: boolean;
}

/**
 * Emits the ephemeral `typing` ws signal while the composer draft is being
 * actively edited. `typing: true` is sent on each edit burst (throttled well
 * under the server's 6s TTL) and `typing: false` on idle, empty/sent drafts,
 * thread switches, and unmount.
 */
export function useTypingEmitter({
  threadId,
  draftText,
  enabled,
}: UseTypingEmitterArgs): void {
  const lastSentAtRef = useRef(0);
  const isTypingRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const isFirstRunForThreadRef = useRef(true);

  useEffect(() => {
    isFirstRunForThreadRef.current = true;
    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (isTypingRef.current) {
        isTypingRef.current = false;
        wsManager.sendTyping(threadId, false);
      }
      lastSentAtRef.current = 0;
    };
  }, [threadId]);

  useEffect(() => {
    // Mounting with a restored draft is not typing — only subsequent edits are.
    if (isFirstRunForThreadRef.current) {
      isFirstRunForThreadRef.current = false;
      return;
    }
    if (!enabled) {
      return;
    }

    if (draftText.length === 0) {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (isTypingRef.current) {
        isTypingRef.current = false;
        wsManager.sendTyping(threadId, false);
      }
      return;
    }

    const now = Date.now();
    if (!isTypingRef.current || now - lastSentAtRef.current >= TYPING_REFRESH_MS) {
      isTypingRef.current = true;
      lastSentAtRef.current = now;
      wsManager.sendTyping(threadId, true);
    }

    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      if (isTypingRef.current) {
        isTypingRef.current = false;
        wsManager.sendTyping(threadId, false);
      }
    }, TYPING_IDLE_TIMEOUT_MS);
  }, [draftText, enabled, threadId]);
}

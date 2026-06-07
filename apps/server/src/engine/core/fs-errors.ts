/**
 * Ported from `apps/host-daemon/src/fs-errors.ts` (P1a engine scaffold; the
 * daemon copy dies in P1c). Single engine-wide copy.
 */
export function isFsErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

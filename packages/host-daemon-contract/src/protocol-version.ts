/**
 * Informational local-API protocol marker reported by `GET /status`. Dev
 * restart tooling uses it to detect stale servers; product UI must not gate
 * behavior on it.
 */
export const HOST_DAEMON_PROTOCOL_VERSION = 32 as const;

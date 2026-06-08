/**
 * The single synthetic host id (single-host plan §2 Decision 4, risk R6: one
 * constant everywhere). The server pins every host id to this value; the
 * contract still requires an explicit hostId on non-personal workspaces,
 * manager environments, and project sources, so the CLI sends the constant.
 */
export const LOCAL_HOST_ID = "local";

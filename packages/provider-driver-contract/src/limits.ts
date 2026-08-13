export const PROVIDER_DRIVER_PROTOCOL_VERSION = 3 as const;

/** Maximum encoded protocol frame. Transport implementations reject it before JSON parsing. */
export const PROVIDER_DRIVER_MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const PROVIDER_DRIVER_MAX_ID_LENGTH = 512;
export const PROVIDER_DRIVER_MAX_MESSAGE_LENGTH = 4_096;
export const PROVIDER_DRIVER_MAX_DETAIL_LENGTH = 16_384;
export const PROVIDER_DRIVER_MAX_MODELS = 4_096;
export const PROVIDER_DRIVER_MAX_DYNAMIC_TOOLS = 256;
export const PROVIDER_DRIVER_MAX_SKILL_SOURCES = 256;

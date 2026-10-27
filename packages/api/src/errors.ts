import { COMMON_ERROR_STATUS_MAP } from "@orpc/server";

/**
 * HTTP status per error code for the RPC handler. Custom codes declared with
 * `.errors()` would otherwise fall back to 400.
 */
export const errorStatusMap: Record<string, number> = {
  ...COMMON_ERROR_STATUS_MAP,
  NO_CREDITS: 402,
  SLOT_UNAVAILABLE: 409,
  TOO_LATE: 409,
  NEGATIVE_BALANCE: 409,
  PLATFORM_DOMAIN: 422,
  RESERVATION_EXPIRED: 409,
};

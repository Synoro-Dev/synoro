import { COMMON_ERROR_STATUS_MAP } from "@orpc/server";

/**
 * HTTP status per error code for the RPC handler. Custom codes declared with
 * `.errors()` would otherwise fall back to 400.
 */
export const errorStatusMap: Record<string, number> = {
  ...COMMON_ERROR_STATUS_MAP,
  NO_CREDITS: 402,
  SLOT_UNAVAILABLE: 409,
  SIGN_IN_REQUIRED: 403,
  TOO_MANY_HOLDS: 429,
  PHONE_REQUIRED: 422,
  TOO_LATE: 409,
  NOT_STARTED: 409,
  NEGATIVE_BALANCE: 409,
  PLATFORM_DOMAIN: 422,
  RESERVATION_EXPIRED: 409,
  PAYMENTS_UNAVAILABLE: 503,
  PAYMENTS_DISABLED: 409,
  SECRET_REQUIRED: 422,
  INVALID_CREDENTIALS: 422,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_ERROR: 502,
};

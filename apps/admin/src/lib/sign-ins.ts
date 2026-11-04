const METHODS: Record<string, string> = {
  "/sign-in/email-otp": "Код из почты",
  "/sign-in/email": "Пароль",
  "/sign-up/email": "Регистрация с паролем",
  "/email-otp/verify-email": "Подтверждение почты",
  "/admin/impersonate-user": "Вход админа под пользователем",
};

/** The auth endpoint that opened a session, in words. */
export const methodLabel = (path: string | null) =>
  path ? (METHODS[path] ?? path) : "—";

const countries = new Intl.DisplayNames("ru", { type: "region" });

function countryName(code: string) {
  try {
    return countries.of(code) ?? code;
  } catch {
    return code;
  }
}

/** «Москва, Россия»; the region only when there is no city. */
export function locationLabel(row: {
  city: string | null;
  region: string | null;
  country: string | null;
}) {
  const parts = [
    row.city ?? row.region,
    row.country ? countryName(row.country) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function browserOf(userAgent: string) {
  // Order matters: Yandex, Edge and Opera also say Chrome, Chrome says Safari.
  if (/YaBrowser/.test(userAgent)) return "Яндекс Браузер";
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/.test(userAgent)) return "Opera";
  if (/Firefox\/|FxiOS/.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS/.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return null;
}

function systemOf(userAgent: string) {
  // iOS says "like Mac OS X", Android says "Linux".
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Mac OS X|Macintosh/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}

/** «Chrome · Windows» out of a User-Agent; the raw string goes in the title. */
export function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "—";
  const parts = [browserOf(userAgent), systemOf(userAgent)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

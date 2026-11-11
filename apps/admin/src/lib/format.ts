const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Moscow",
});

const dateTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

/** Dates on the admin site are Moscow time, like the team reads them. */
export const formatDate = (date: Date | null | undefined) =>
  date ? dateFormat.format(date) : "—";

export const formatDateTime = (date: Date | null | undefined) =>
  date ? dateTimeFormat.format(date) : "—";

/** Kopecks → «1 490 ₽». */
export const formatKopecks = (kopecks: number) => rubles.format(kopecks / 100);

export const formatCount = (value: number) => value.toLocaleString("ru-RU");

const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const rubKopecks = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 2,
});

/** Kopecks as «14 000 ₽» (kopecks shown only when there are any). */
export function formatRub(kopecks: number) {
  return (kopecks % 100 ? rubKopecks : rub).format(kopecks / 100);
}

/** «консультация», «консультации», «консультаций» to go after `count`. */
export function consultationWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "консультация";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "консультации";
  }
  return "консультаций";
}

/** «1 консультация», «3 консультации», «5 консультаций». */
export function consultations(count: number) {
  return `${count} ${consultationWord(count)}`;
}

export const PAYMENT_STATUS = {
  pending: { label: "Ожидает оплаты", badge: "warning-light" },
  succeeded: { label: "Оплачен", badge: "success-light" },
  canceled: { label: "Не прошёл", badge: "destructive-light" },
} as const;

/**
 * Price per consultation of each package, and how much cheaper it is than
 * the most expensive one per consultation (usually the single session).
 */
export function packageDeals<T extends { credits: number; price: number }>(
  packages: T[],
) {
  const unitPrices = packages.map((p) => p.price / p.credits);
  const base = Math.max(...unitPrices);
  return packages.map((p, i) => {
    const unit = unitPrices[i] ?? base;
    return {
      ...p,
      unitPrice: Math.round(unit),
      discount: base > 0 ? Math.round((1 - unit / base) * 100) : 0,
    };
  });
}

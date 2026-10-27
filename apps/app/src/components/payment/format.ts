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

export const PAYMENT_STATUS = {
  pending: { label: "Ожидает оплаты", badge: "warning-light" },
  succeeded: { label: "Оплачен", badge: "success-light" },
  canceled: { label: "Не прошёл", badge: "destructive-light" },
} as const;

/**
 * Price per credit of each package, and how much cheaper it is than the
 * most expensive one per credit (usually the single one).
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

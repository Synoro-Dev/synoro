/**
 * Finding a practice client by what a caller says first: a name or a few
 * digits of the phone. Stored phones are E.164 (`+79001234567`).
 */

/** Digits only, a full number's leading 8 read as 7: «8 900 123-45-67» → «79001234567». */
export function phoneDigits(value: string) {
  return value.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7");
}

/**
 * Clients whose name contains `query`, or whose phone contains its digits
 * (three or more) — what a caller says first. A number begun with 8 also
 * matches the start of the stored +7 one before all 11 digits are typed.
 */
export function matchClients<T extends { name: string; phone: string | null }>(
  clients: T[],
  query: string,
) {
  const text = query.trim().toLowerCase();
  if (!text) return clients;
  const digits = query.replace(/\D/g, "");
  const asSeven = digits.startsWith("8") ? `7${digits.slice(1)}` : null;
  return clients.filter((c) => {
    if (c.name.toLowerCase().includes(text)) return true;
    if (digits.length < 3 || !c.phone) return false;
    const phone = phoneDigits(c.phone);
    return phone.includes(digits) || (!!asSeven && phone.startsWith(asSeven));
  });
}

import { and, isNotNull, isNull, or, SignIn, type SQL } from "@synoro/db";

export type SignInSourceKind = "ad" | "referral" | "direct";

interface SourceColumns {
  yclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerHost: string | null;
}

/**
 * An ad is a visit with a Yandex Direct click or UTM tags; any other visit
 * that had a referring site is a referral; the rest came straight in.
 */
export function sourceKind(row: SourceColumns): SignInSourceKind {
  // Any UTM tag makes the landing treat the visit as an ad (ad-click.tsx).
  if (
    row.yclid ||
    row.utmSource ||
    row.utmMedium ||
    row.utmCampaign ||
    row.utmContent ||
    row.utmTerm
  ) {
    return "ad";
  }
  return row.referrerHost ? "referral" : "direct";
}

const isAd = () =>
  or(
    isNotNull(SignIn.yclid),
    isNotNull(SignIn.utmSource),
    isNotNull(SignIn.utmMedium),
    isNotNull(SignIn.utmCampaign),
    isNotNull(SignIn.utmContent),
    isNotNull(SignIn.utmTerm),
  );

/** The `where` for a source filter, the SQL twin of `sourceKind`. */
export function sourceCondition(kind: SignInSourceKind): SQL | undefined {
  if (kind === "ad") return isAd();
  const notAd = and(
    isNull(SignIn.yclid),
    isNull(SignIn.utmSource),
    isNull(SignIn.utmMedium),
    isNull(SignIn.utmCampaign),
    isNull(SignIn.utmContent),
    isNull(SignIn.utmTerm),
  );
  return kind === "referral"
    ? and(notAd, isNotNull(SignIn.referrerHost))
    : and(notAd, isNull(SignIn.referrerHost));
}

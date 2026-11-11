import { Badge } from "@synoro/ui";

export interface VisitSourceData {
  kind: "ad" | "referral" | "direct";
  yclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerHost: string | null;
}

/** Where a visit came from: an ad with its tags, a referring site, or direct. */
export function VisitSource({ source }: { source: VisitSourceData | null }) {
  if (!source) return <span className="text-muted-foreground">—</span>;
  if (source.kind === "direct") {
    return <span className="text-muted-foreground">Напрямую</span>;
  }
  if (source.kind === "referral") {
    return (
      <div className="flex flex-col">
        <span>{source.referrerHost}</span>
        <span className="text-muted-foreground text-xs">переход с сайта</span>
      </div>
    );
  }
  const channel = [source.utmSource, source.utmMedium]
    .filter(Boolean)
    .join(" / ");
  const details = [source.utmCampaign, source.utmContent, source.utmTerm]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <Badge variant="secondary">реклама</Badge>
        {channel || (source.yclid ? "Яндекс Директ" : "Реклама")}
      </span>
      {details && (
        <span className="text-muted-foreground text-xs">{details}</span>
      )}
      {source.yclid && (
        <span className="text-muted-foreground text-xs">
          yclid <code>{source.yclid}</code>
        </span>
      )}
    </div>
  );
}

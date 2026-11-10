import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@synoro/ui";
import type { Route } from "next";
import Link from "next/link";

import { formatDateTime } from "~/lib/format";
import { deviceLabel, locationLabel, methodLabel } from "~/lib/sign-ins";
import { VisitSource } from "./visit-source";

export interface SignInItem {
  id: string;
  createdAt: Date;
  method: string | null;
  impersonatedBy: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  yclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  source: "ad" | "referral" | "direct";
  userId: string;
  userName: string;
  userEmail: string;
}

function Source({ item }: { item: SignInItem }) {
  return <VisitSource source={{ kind: item.source, ...item }} />;
}

/** One row per sign-in; `showUser` is off on a user's own card. */
export function SignInTable({
  items,
  showUser = true,
}: {
  items: SignInItem[];
  showUser?: boolean;
}) {
  const columns = showUser ? 6 : 5;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Когда</TableHead>
          {showUser && <TableHead>Пользователь</TableHead>}
          <TableHead>IP и город</TableHead>
          <TableHead>Откуда пришёл</TableHead>
          <TableHead>Устройство</TableHead>
          <TableHead>Способ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={columns}
              className="text-muted-foreground h-24 text-center"
            >
              Входов нет
            </TableCell>
          </TableRow>
        )}
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="whitespace-nowrap">
              {formatDateTime(item.createdAt)}
            </TableCell>
            {showUser && (
              <TableCell>
                <Link
                  href={`/users/${item.userId}` as Route}
                  className="flex flex-col hover:underline"
                >
                  <span>{item.userName}</span>
                  <span className="text-muted-foreground text-xs">
                    {item.userEmail}
                  </span>
                </Link>
              </TableCell>
            )}
            <TableCell>
              <div className="flex flex-col">
                <span className="tabular-nums">{item.ipAddress ?? "—"}</span>
                <span className="text-muted-foreground text-xs">
                  {locationLabel(item) ?? "город не определён"}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <Source item={item} />
            </TableCell>
            <TableCell title={item.userAgent ?? undefined}>
              {deviceLabel(item.userAgent)}
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-2">
                {methodLabel(item.method)}
                {item.impersonatedBy && (
                  <Badge variant="outline">от имени админа</Badge>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

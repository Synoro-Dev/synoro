"use client";

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import { formatCredits, formatPhone } from "@synoro/validators";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarPlusIcon,
  CalendarXIcon,
  MailIcon,
  PhoneIcon,
  SlidersHorizontalIcon,
  WalletIcon,
} from "lucide-react";

import { orpc } from "~/orpc/react";
import { kindLabel } from "./booking-dialog";
import { HistoryList } from "./client-dialogs";
import type { Member } from "./practice-clients";
import { EmptyState, ErrorState } from "./states";
import { useTerms } from "./terms";
import { dateKey, formatTime } from "./time";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The card shows a month back and a month ahead (the calendar's limit). */
const BACK_DAYS = 30;
const SPAN_DAYS = 61;

/**
 * One client at a glance: how to reach them, the balance, their bookings
 * and the balance journal — with booking and crediting one tap away.
 */
export function ClientCard({
  practiceId,
  timezone,
  member,
  onClose,
  onBook,
  onCredit,
}: {
  practiceId: string;
  timezone: string;
  member: Member | null;
  onClose: () => void;
  onBook: (member: Member) => void;
  onCredit: (member: Member, intent: "grant" | "adjust") => void;
}) {
  const terms = useTerms();

  return (
    <Sheet open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {member && (
          <>
            <SheetHeader className="gap-3 border-b">
              <div className="flex flex-col gap-1">
                <SheetTitle className="text-lg">{member.name}</SheetTitle>
                <SheetDescription className="flex flex-col gap-1">
                  {member.phone && (
                    <a
                      href={`tel:${member.phone}`}
                      className="flex min-h-8 items-center gap-2 tabular-nums hover:text-foreground"
                    >
                      <PhoneIcon className="size-4" aria-hidden />
                      {formatPhone(member.phone)}
                    </a>
                  )}
                  <a
                    href={`mailto:${member.email}`}
                    className="flex min-h-8 items-center gap-2 hover:text-foreground"
                  >
                    <MailIcon className="size-4" aria-hidden />
                    <span className="truncate">{member.email}</span>
                  </a>
                </SheetDescription>
              </div>
              <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2.5 dark:bg-muted/50">
                <span className="text-sm text-muted-foreground">
                  На балансе
                </span>
                <span
                  className={
                    member.credits === 0
                      ? "font-semibold text-warning-foreground"
                      : "font-semibold"
                  }
                >
                  {formatCredits(member.credits, terms)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => onBook(member)}>
                  <CalendarPlusIcon />
                  Записать
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onCredit(member, "grant")}
                >
                  <WalletIcon />
                  Начислить
                </Button>
                <Button
                  variant="ghost"
                  className="col-span-2 text-muted-foreground"
                  onClick={() => onCredit(member, "adjust")}
                >
                  <SlidersHorizontalIcon />
                  Скорректировать баланс
                </Button>
              </div>
            </SheetHeader>
            <Tabs
              defaultValue="bookings"
              className="min-h-0 flex-1 gap-4 overflow-y-auto p-4"
            >
              <TabsList className="w-full">
                <TabsTrigger value="bookings">Записи</TabsTrigger>
                <TabsTrigger value="balance">Журнал баланса</TabsTrigger>
              </TabsList>
              <TabsContent value="bookings">
                <ClientBookings
                  practiceId={practiceId}
                  timezone={timezone}
                  memberId={member.id}
                />
              </TabsContent>
              <TabsContent value="balance">
                <HistoryList memberId={member.id} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ClientBookings({
  practiceId,
  timezone,
  memberId,
}: {
  practiceId: string;
  timezone: string;
  memberId: string;
}) {
  const terms = useTerms();
  const from = dateKey(new Date(Date.now() - BACK_DAYS * DAY_MS), timezone);
  const calendar = useQuery(
    orpc.booking.calendar.queryOptions({
      input: { practiceId, from, days: SPAN_DAYS },
    }),
  );

  if (calendar.isError) {
    return <ErrorState onRetry={() => calendar.refetch()} />;
  }
  if (calendar.isPending) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  const now = Date.now();
  const mine = calendar.data
    .filter((b) => b.memberId === memberId)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  if (mine.length === 0) {
    return (
      <EmptyState
        icon={CalendarXIcon}
        title="Записей нет"
        description="За последний месяц и на месяц вперёд записей нет."
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {mine.map((b) => (
        <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium first-letter:uppercase">
              {b.startsAt.toLocaleDateString("ru-RU", {
                weekday: "short",
                day: "numeric",
                month: "long",
              })}
              , {formatTime(b.startsAt)}
            </span>
            <span className="text-sm text-muted-foreground">
              {kindLabel(b.kind, terms)}
            </span>
          </div>
          {b.holdUntil ? (
            <Badge variant="warning-light">Ждёт оплаты</Badge>
          ) : b.endsAt.getTime() > now ? (
            <Badge variant="success-light">Предстоит</Badge>
          ) : (
            <Badge variant="outline">Прошла</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

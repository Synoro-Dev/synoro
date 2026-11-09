"use client";

import { isDefinedError } from "@orpc/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@synoro/ui";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  formatCredits,
  OFFLINE_PAYMENT_METHOD_LABELS,
  OFFLINE_PAYMENT_METHODS,
  type OfflinePaymentMethod,
  offlinePaymentFormSchema,
  parseRubles,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BanknoteIcon,
  CircleCheckIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { ConfirmButton } from "~/components/booking/confirm-button";
import { EmptyState, ErrorState } from "~/components/booking/states";
import { useTerms } from "~/components/booking/terms";
import {
  dateKey,
  formatDateTime,
  zonedDayStart,
} from "~/components/booking/time";
import { formatRub } from "~/components/payment/format";
import { orpc } from "~/orpc/react";

/** What a payment is for when it pays a booking from «Ждут оплаты». */
interface PaidBooking {
  id: string;
  startsAt: Date;
  clientName: string;
}

/**
 * «Внести оплату»: how much, how and when a client paid outside Synoro. For a
 * booking from «Ждут оплаты» the client is the booking's; otherwise staff
 * pick one. `paidAt` is today now, another day at its noon.
 */
function OfflinePaymentDialog({
  practiceId,
  timezone,
  open,
  booking,
  onClose,
}: {
  practiceId: string;
  timezone: string;
  open: boolean;
  booking: PaidBooking | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const members = useQuery({
    ...orpc.practice.members.queryOptions({ input: { practiceId } }),
    enabled: open && booking === null,
  });
  const clients = (members.data ?? []).filter((m) => m.role === "client");
  const today = dateKey(new Date(), timezone);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<OfflinePaymentMethod>("transfer");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");

  /** Close and forget the draft: the next booking starts blank. */
  function close() {
    setMemberId(null);
    setAmount("");
    setMethod("transfer");
    setDay(today);
    setNote("");
    onClose();
  }

  /** Income moves: the payments page and the analytics show it. */
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.offlinePayment.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.analytics.key() }),
    ]);
  }

  const save = useMutation({
    ...orpc.offlinePayment.record.mutationOptions(),
    onSuccess: async () => {
      toast.success("Оплата записана");
      await refresh();
      close();
    },
    onError: async (error) => {
      toast.error(error.message);
      if (isDefinedError(error) && error.code === "ALREADY_PAID") {
        await refresh();
        close();
      }
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = offlinePaymentFormSchema.safeParse({
      amount: parseRubles(amount),
      method,
      paidAt:
        day === today
          ? new Date()
          : new Date(zonedDayStart(day, timezone).getTime() + 12 * 3_600_000),
      note: note || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте оплату");
      return;
    }
    if (!booking && !memberId) {
      toast.error("Выберите клиента");
      return;
    }
    save.mutate({
      practiceId,
      ...parsed.data,
      ...(booking ? { bookingId: booking.id } : { memberId: memberId ?? "" }),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !save.isPending) close();
      }}
    >
      {/* Clients' names: `ph-no-capture`, like the list it opens from. */}
      <DialogContent className="ph-no-capture sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Внести оплату</DialogTitle>
            <DialogDescription>
              {booking
                ? `${booking.clientName}, запись ${formatDateTime(booking.startsAt, timezone)}.`
                : "Деньги, которые клиент заплатил вам напрямую: наличными, переводом или картой."}{" "}
              Баланс клиента не меняется.
            </DialogDescription>
          </DialogHeader>

          {!booking && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="offline-client">Клиент</Label>
              {members.isError ? (
                <ErrorState onRetry={() => members.refetch()} />
              ) : members.isPending ? (
                <Skeleton className="h-9 w-full rounded-md" />
              ) : (
                <Select
                  items={Object.fromEntries(clients.map((c) => [c.id, c.name]))}
                  value={memberId}
                  onValueChange={(value) =>
                    setMemberId(value ? String(value) : null)
                  }
                >
                  <SelectTrigger id="offline-client" className="w-full">
                    <SelectValue placeholder="Выберите клиента" />
                  </SelectTrigger>
                  {/* The list opens in a portal of its own. */}
                  <SelectContent className="ph-no-capture">
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="offline-amount">Сумма</Label>
              <InputGroup>
                <InputGroupInput
                  id="offline-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="3 000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <InputGroupAddon align="inline-end">₽</InputGroupAddon>
              </InputGroup>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="offline-day">Дата</Label>
              <Input
                id="offline-day"
                type="date"
                required
                max={today}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="offline-method">Способ</Label>
            <ToggleGroup
              aria-labelledby="offline-method"
              variant="outline"
              size="sm"
              value={[method]}
              onValueChange={(value) => {
                const next = value[0] as OfflinePaymentMethod | undefined;
                if (next) setMethod(next);
              }}
            >
              {OFFLINE_PAYMENT_METHODS.map((option) => (
                <ToggleGroupItem key={option} value={option} className="px-2.5">
                  {OFFLINE_PAYMENT_METHOD_LABELS[option]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offline-note">Комментарий</Label>
            <Input
              id="offline-note"
              placeholder="По желанию"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={close}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={save.isPending || amount === ""}>
              Записать оплату
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Frame spacing="default" className="min-w-0">
      <FramePanel className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <FrameHeader className="p-0">
            <FrameTitle>{title}</FrameTitle>
            <FrameDescription>{description}</FrameDescription>
          </FrameHeader>
          {action}
        </div>
        {children}
      </FramePanel>
    </Frame>
  );
}

/**
 * Bookings paid at the visit that took place and have no payment written
 * down (`offlinePayment.unpaid`); one tap opens «Внести оплату» for it.
 * Hidden while there are none.
 */
export function UnpaidBookings({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const unpaid = useQuery(
    orpc.offlinePayment.unpaid.queryOptions({ input: { practiceId } }),
  );
  const [paying, setPaying] = useState<PaidBooking | null>(null);

  if (unpaid.isError) return <ErrorState onRetry={() => unpaid.refetch()} />;
  if (unpaid.isPending || unpaid.data.length === 0) return null;

  return (
    <Section
      title="Ждут оплаты"
      description="Прошедшие записи с оплатой на приёме, по которым оплата ещё не отмечена. За последние 90 дней."
    >
      <ul className="ph-no-capture flex flex-col divide-y rounded-lg border">
        {unpaid.data.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">
                {b.clientName}
              </span>
              <span className="text-sm text-muted-foreground first-letter:uppercase">
                {formatDateTime(b.startsAt, timezone)}
                {b.serviceName ? ` · ${b.serviceName}` : ""}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setPaying({
                  id: b.id,
                  startsAt: b.startsAt,
                  clientName: b.clientName,
                })
              }
            >
              <CircleCheckIcon />
              Оплачено
            </Button>
          </li>
        ))}
      </ul>
      <OfflinePaymentDialog
        practiceId={practiceId}
        timezone={timezone}
        open={paying !== null}
        booking={paying}
        onClose={() => setPaying(null)}
      />
    </Section>
  );
}

/**
 * Money received outside Synoro: the last 30 days in total, the last 100
 * payments, «Внести оплату», and removing one written down by mistake.
 */
export function OfflinePayments({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const terms = useTerms();
  const queryClient = useQueryClient();
  const list = useQuery(
    orpc.offlinePayment.list.queryOptions({ input: { practiceId } }),
  );
  const [adding, setAdding] = useState(false);
  const remove = useMutation({
    ...orpc.offlinePayment.remove.mutationOptions(),
    onSuccess: async () => {
      toast.success("Оплата удалена");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.offlinePayment.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.analytics.key() }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Section
      title="Оплаты вне Synoro"
      description="Наличные, переводы и карта — что клиенты заплатили вам напрямую"
      action={
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon />
          Внести оплату
        </Button>
      }
    >
      {list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-32 w-full rounded-md" />
      ) : list.data.payments.length === 0 ? (
        <EmptyState
          icon={BanknoteIcon}
          title="Оплат пока нет"
          description="Записывайте оплату наличными и переводом — так доход за месяц будет виден целиком."
        />
      ) : (
        <>
          <div className="flex items-baseline justify-between rounded-md border p-3">
            <span className="text-xs text-muted-foreground">За 30 дней</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatRub(list.data.month.amount)}
            </span>
          </div>
          <Table className="ph-no-capture">
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Клиент</TableHead>
                <TableHead>За что</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead>
                  <span className="sr-only">Удалить</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {p.paidAt.toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: timezone,
                    })}
                  </TableCell>
                  <TableCell className="max-w-40 truncate">
                    {p.clientName ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-48 text-sm">
                    <div className="flex flex-col">
                      <span className="truncate">
                        {p.bookingStartsAt
                          ? `Запись ${formatDateTime(p.bookingStartsAt, timezone)}`
                          : p.credits
                            ? `Пакет: ${formatCredits(p.credits, terms)}`
                            : (p.note ?? "—")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {OFFLINE_PAYMENT_METHOD_LABELS[p.method]}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                    {formatRub(p.amount)}
                  </TableCell>
                  <TableCell className="w-10">
                    <ConfirmButton
                      variant="ghost"
                      size="xs"
                      title="Удалить оплату?"
                      description="Пропадёт только запись о деньгах. Начисленное на баланс останется — его можно скорректировать в карточке клиента."
                      confirmLabel="Удалить"
                      disabled={remove.isPending}
                      onConfirm={() =>
                        remove.mutate({ practiceId, paymentId: p.id })
                      }
                    >
                      <TrashIcon />
                      <span className="sr-only">Удалить</span>
                    </ConfirmButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      <OfflinePaymentDialog
        practiceId={practiceId}
        timezone={timezone}
        open={adding}
        booking={null}
        onClose={() => setAdding(false)}
      />
    </Section>
  );
}

"use client";

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
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@synoro/ui/reui/number-field";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@synoro/ui/reui/timeline";
import {
  creditGrantFormSchema,
  type MemberInviteFormValues,
  memberInviteFormSchema,
  OFFLINE_PAYMENT_METHOD_LABELS,
  OFFLINE_PAYMENT_METHODS,
  type OfflinePaymentMethod,
  offlinePaymentFormSchema,
  parseRubles,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HistoryIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import type { Member } from "./practice-clients";
import { EmptyState, ErrorState } from "./states";
import { useTerms } from "./terms";
import { formatDateTime } from "./time";

const REASON_LABELS = {
  purchase: "Оплата",
  booking: "Запись",
  refund: "Возврат",
  adjustment: "Корректировка",
} as const;

/**
 * Record paid credits for one client («Начислить») or correct the
 * balance either way («Скорректировать»): the same entry, two intents.
 */
export function CreditDialog({
  practiceId,
  member,
  intent = "grant",
  onClose,
}: {
  practiceId: string;
  member: Member | null;
  intent?: "grant" | "adjust";
  onClose: () => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {member && (
          <CreditForm
            practiceId={practiceId}
            member={member}
            intent={intent}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreditForm({
  practiceId,
  member,
  intent,
  onDone,
}: {
  practiceId: string;
  member: Member;
  intent: "grant" | "adjust";
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const terms = useTerms();
  const grantOnly = intent === "grant";
  const [delta, setDelta] = useState<number | null>(
    grantOnly || member.credits === 0 ? 1 : -1,
  );
  const [note, setNote] = useState("");
  /** What the client paid for a grant outside Synoro, if anything. */
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<OfflinePaymentMethod>("transfer");
  const next = member.credits + (delta ?? 0);

  const grant = useMutation({
    ...orpc.credit.grant.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        grantOnly
          ? `Начислено. На балансе ${member.name}: ${result.credits}`
          : `Баланс изменён. На балансе ${member.name}: ${result.credits}`,
      );
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.credit.key() });
      await queryClient.invalidateQueries({
        queryKey: orpc.offlinePayment.key(),
      });
      await queryClient.invalidateQueries({ queryKey: orpc.analytics.key() });
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = creditGrantFormSchema.safeParse({
      delta: delta ?? 0,
      note: note || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте количество");
      return;
    }
    let payment: ReturnType<typeof offlinePaymentFormSchema.parse> | undefined;
    if (grantOnly && amount.trim() !== "") {
      const paid = offlinePaymentFormSchema.safeParse({
        amount: parseRubles(amount),
        method,
        paidAt: new Date(),
      });
      if (!paid.success) {
        toast.error(paid.error.issues[0]?.message ?? "Проверьте сумму");
        return;
      }
      payment = paid.data;
    }
    grant.mutate({ practiceId, memberId: member.id, ...parsed.data, payment });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>
          {grantOnly ? "Начислить" : "Скорректировать баланс"}
        </DialogTitle>
        <DialogDescription>
          {grantOnly
            ? `${member.name}: сколько ${terms.credit[2]} добавить на баланс после оплаты.`
            : `${member.name}: плюс добавляет ${terms.credits}, минус списывает.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <NumberField
          value={delta}
          onValueChange={setDelta}
          min={grantOnly ? 1 : -member.credits}
          max={100}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement />
            <NumberFieldInput aria-label={`Количество: ${terms.credit[2]}`} />
            <NumberFieldIncrement />
          </NumberFieldGroup>
        </NumberField>
        <div className="flex gap-2">
          {[1, 5, 10].map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDelta(n)}
            >
              +{n}
            </Button>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm dark:bg-muted/50">
          <span className="text-muted-foreground">Станет</span>
          <span className="font-semibold tabular-nums">
            {member.credits} → {next}
          </span>
        </div>
      </div>

      {grantOnly && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="credit-amount">Сколько заплатил клиент</Label>
          <InputGroup>
            <InputGroupInput
              id="credit-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="По желанию"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <InputGroupAddon align="inline-end">₽</InputGroupAddon>
          </InputGroup>
          {amount.trim() !== "" && (
            <ToggleGroup
              aria-label="Способ оплаты"
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
          )}
          <p className="text-xs text-muted-foreground">
            С суммой оплата попадёт в раздел «Оплаты» и в доход практики.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="credit-note">Комментарий</Label>
        <Input
          id="credit-note"
          placeholder="Оплата пакета из 5"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Отмена
        </Button>
        <Button type="submit" disabled={grant.isPending || !delta || next < 0}>
          {grantOnly ? "Начислить" : "Сохранить"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A client's balance history on the ReUI timeline. */
export function HistoryList({ memberId }: { memberId: string }) {
  const history = useQuery(
    orpc.credit.history.queryOptions({ input: { memberId } }),
  );

  if (history.isError) {
    return <ErrorState onRetry={() => history.refetch()} />;
  }
  if (history.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {["a", "b", "c"].map((k) => (
          <Skeleton key={k} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (history.data.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="Пусто"
        description="Начислений и списаний ещё не было."
      />
    );
  }

  return (
    <Timeline defaultValue={history.data.length}>
      {history.data.map((entry, index) => (
        <TimelineItem key={entry.id} step={index + 1}>
          <TimelineHeader>
            <TimelineSeparator />
            <TimelineDate>{formatDateTime(entry.createdAt)}</TimelineDate>
            <TimelineTitle className="flex items-center gap-2">
              {REASON_LABELS[entry.reason]}
              <Badge
                variant={
                  entry.delta > 0 ? "success-light" : "destructive-light"
                }
              >
                {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
              </Badge>
            </TimelineTitle>
            <TimelineIndicator />
          </TimelineHeader>
          {entry.note && <TimelineContent>{entry.note}</TimelineContent>}
        </TimelineItem>
      ))}
    </Timeline>
  );
}

/** Invite a registered user as a client or, for the owner, an administrator. */
export function AddMemberDialog({
  practiceId,
  invite: role,
  open,
  onClose,
}: {
  practiceId: string;
  invite: MemberInviteFormValues["role"];
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const add = useMutation({
    ...orpc.practice.addMember.mutationOptions(),
    onSuccess: async ({ mail }) => {
      if (mail === "failed") {
        toast.warning(
          "Приглашение сохранено, но письмо не ушло. Его увидят в разделе «Практики» после входа с этой почтой — сообщите об этом сами.",
        );
      } else if (mail === "queued") {
        toast.success(
          "Приглашение сохранено, письмо отправляется. Его примут в разделе «Практики» после входа с этой почтой.",
        );
      } else if (mail === "recent") {
        toast.success(
          "Приглашение продлено на 7 дней. Письмо на этот адрес уже отправляли недавно.",
        );
      } else {
        toast.success(
          "Приглашение отправлено на почту. Его примут в разделе «Практики» после входа с этой почтой.",
        );
      }
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = memberInviteFormSchema.safeParse({ email, role });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте почту");
      return;
    }
    add.mutate({ practiceId, ...parsed.data });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>
              {role === "admin"
                ? "Пригласить администратора"
                : "Пригласить клиента"}
            </DialogTitle>
            <DialogDescription>
              Приглашение действует 7 дней и принимается с подтверждённой почты.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-email">Почта</Label>
            <Input
              id="member-email"
              type="email"
              autoFocus
              placeholder="client@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={add.isPending}>
              Пригласить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

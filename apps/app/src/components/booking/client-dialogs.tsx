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
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
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
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HistoryIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import type { Member } from "./practice-clients";
import { EmptyState, ErrorState } from "./states";
import { formatDateTime } from "./time";

const REASON_LABELS = {
  purchase: "Оплата",
  booking: "Запись",
  refund: "Возврат",
  adjustment: "Корректировка",
} as const;

/** Record paid consultations (or correct the balance) for one client. */
export function CreditDialog({
  practiceId,
  member,
  onClose,
}: {
  practiceId: string;
  member: Member | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {member && (
          <CreditForm
            practiceId={practiceId}
            member={member}
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
  onDone,
}: {
  practiceId: string;
  member: Member;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [delta, setDelta] = useState<number | null>(1);
  const [note, setNote] = useState("");
  const next = member.credits + (delta ?? 0);

  const grant = useMutation({
    ...orpc.credit.grant.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(`${member.name}: оплачено ${result.credits}`);
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.credit.key() });
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
    grant.mutate({ practiceId, memberId: member.id, ...parsed.data });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Баланс: {member.name}</DialogTitle>
        <DialogDescription>
          Плюс — оплаченные консультации, минус — списание.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <NumberField
          value={delta}
          onValueChange={setDelta}
          min={-member.credits}
          max={100}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement />
            <NumberFieldInput aria-label="Количество консультаций" />
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
          Сохранить
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A client's balance history on the ReUI timeline. */
export function HistorySheet({
  member,
  onClose,
}: {
  member: Member | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {member && (
          <>
            <SheetHeader>
              <SheetTitle>История баланса</SheetTitle>
              <SheetDescription>
                {member.name} · сейчас оплачено {member.credits}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
              <HistoryList memberId={member.id} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function HistoryList({ memberId }: { memberId: string }) {
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

/** Add a registered user as a client (or, for the owner, an administrator). */
export function AddMemberDialog({
  practiceId,
  isOwner,
  open,
  onClose,
}: {
  practiceId: string;
  isOwner: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberInviteFormValues["role"]>("client");

  const add = useMutation({
    ...orpc.practice.addMember.mutationOptions(),
    onSuccess: async () => {
      toast.success(
        "Приглашение отправлено. Его примут в разделе «Практики» после входа с этой почтой.",
      );
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
            <DialogTitle>Пригласить в практику</DialogTitle>
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
          {isOwner && (
            <div className="flex flex-col gap-1.5">
              <Label>Роль</Label>
              <ToggleGroup
                variant="outline"
                value={[role]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "client" || next === "admin") setRole(next);
                }}
              >
                <ToggleGroupItem value="client">Клиент</ToggleGroupItem>
                <ToggleGroupItem value="admin">Администратор</ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
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

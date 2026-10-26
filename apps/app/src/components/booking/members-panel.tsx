"use client";

import {
  Badge,
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@acme/ui";
import {
  creditGrantFormSchema,
  type MemberInviteFormValues,
  memberInviteFormSchema,
} from "@acme/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ROLE_LABELS } from "./practice-list";

/** Clients with balances, recording paid consultations, adding people. */
export function MembersPanel({
  practiceId,
  isOwner,
}: {
  practiceId: string;
  isOwner: boolean;
}) {
  const { data, isPending } = useQuery(
    orpc.practice.members.queryOptions({ input: { practiceId } }),
  );

  return (
    <div className="flex flex-col gap-6">
      <AddMemberForm practiceId={practiceId} isOwner={isOwner} />
      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead className="text-right">Оплачено</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.email}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={m.role === "client" ? "secondary" : "default"}
                  >
                    {ROLE_LABELS[m.role]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.role === "client" ? m.credits : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {m.role === "client" && (
                    <GrantCredits
                      practiceId={practiceId}
                      memberId={m.id}
                      name={m.name}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function GrantCredits({
  practiceId,
  memberId,
  name,
}: {
  practiceId: string;
  memberId: string;
  name: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("1");
  const [note, setNote] = useState("");

  const grant = useMutation({
    ...orpc.credit.grant.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(`${name}: оплачено консультаций — ${result.credits}`);
      setOpen(false);
      setDelta("1");
      setNote("");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = creditGrantFormSchema.safeParse({
      delta: Number(delta),
      note: note || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте количество");
      return;
    }
    grant.mutate({ practiceId, memberId, ...parsed.data });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        Изменить баланс
      </PopoverTrigger>
      <PopoverContent align="end">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label htmlFor={`delta-${memberId}`}>
              Количество (минус — списать)
            </Label>
            <Input
              id={`delta-${memberId}`}
              type="number"
              min={-100}
              max={100}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`note-${memberId}`}>Комментарий</Label>
            <Input
              id={`note-${memberId}`}
              placeholder="Оплата пакета из 5"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={grant.isPending}>
            Сохранить
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function AddMemberForm({
  practiceId,
  isOwner,
}: {
  practiceId: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberInviteFormValues["role"]>("client");

  const add = useMutation({
    ...orpc.practice.addMember.mutationOptions(),
    onSuccess: async () => {
      toast.success("Добавлено");
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
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
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-64 flex-1 space-y-1">
        <Label htmlFor="member-email">
          Добавить зарегистрированного пользователя
        </Label>
        <Input
          id="member-email"
          type="email"
          placeholder="client@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <select
        aria-label="Роль"
        value={role}
        onChange={(e) =>
          setRole(e.target.value as MemberInviteFormValues["role"])
        }
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs dark:bg-input/30"
      >
        <option value="client">Клиент</option>
        {isOwner && <option value="admin">Администратор</option>}
      </select>
      <Button type="submit" disabled={add.isPending}>
        Добавить
      </Button>
    </form>
  );
}

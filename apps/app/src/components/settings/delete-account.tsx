"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { orpc } from "~/orpc/react";
import { ErrorState } from "../booking/states";
import { useDataAccess } from "./data-access";

type Status = RouterOutputs["account"]["deletionStatus"];

function formatDate(at: Date) {
  return at.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function RestoreButton() {
  const queryClient = useQueryClient();
  const restore = useMutation({
    ...orpc.account.cancelDeletion.mutationOptions(),
    onSuccess: async () => {
      toast.success("Аккаунт восстановлен, страница записи снова открыта");
      await queryClient.invalidateQueries({
        queryKey: orpc.account.key(),
      });
      await queryClient.invalidateQueries({ queryKey: orpc.data.key() });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={restore.isPending}
      onClick={() => restore.mutate()}
    >
      Восстановить аккаунт
    </Button>
  );
}

/**
 * On every page of the cabinet while the account is on its way out: nobody
 * should discover it by a client's call that the booking page is closed.
 */
export function DeletionBanner() {
  const status = useQuery({
    ...orpc.account.deletionStatus.queryOptions(),
    // Refused for demo and impersonated sessions: then there's no banner.
    retry: false,
  });
  const pending = status.data?.pending;
  if (!pending) return null;

  return (
    <div className="p-4 pb-0 lg:px-6 lg:pt-6">
      <Alert variant="warning">
        <CircleAlertIcon />
        <AlertTitle>
          Аккаунт будет удалён {formatDate(pending.purgeAt)}
        </AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>
            Страница записи закрыта, напоминания остановлены. До этой даты можно
            всё вернуть.
          </span>
          <RestoreButton />
        </AlertDescription>
      </Alert>
    </div>
  );
}

function DeleteDialog({
  status,
  email,
  open,
  onClose,
}: {
  status: Status;
  email: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const access = useDataAccess();
  const [confirm, setConfirm] = useState("");
  const [cancelBookings, setCancelBookings] = useState(true);

  const upcoming = status.practices.reduce((sum, p) => sum + p.upcoming, 0);
  const guests = status.practices.reduce((sum, p) => sum + p.upcomingGuests, 0);

  const request = useMutation({
    ...orpc.account.requestDeletion.mutationOptions(),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: orpc.account.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.data.key() });
    },
    onError: (error, variables) =>
      access.onError(error, () => request.mutate(variables)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    request.mutate({ confirm, cancelBookings });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Удалить аккаунт?</DialogTitle>
              <DialogDescription>
                Страница записи закроется сразу. Через {status.graceDays} дней
                всё будет удалено безвозвратно, а до этого можно передумать.
              </DialogDescription>
            </DialogHeader>

            {upcoming > 0 && (
              <div className="flex items-start gap-3">
                <Checkbox
                  id="cancel-bookings"
                  checked={cancelBookings}
                  onCheckedChange={setCancelBookings}
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-1">
                  <Label htmlFor="cancel-bookings">
                    Отменить предстоящие записи ({upcoming}) и написать клиентам
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Клиенты получат письмо, а занятия вернутся на их баланс.
                    {guests > 0 &&
                      ` Гостям, записанным по телефону (${guests}), мы написать не можем: предупредите их сами.`}
                    {!cancelBookings &&
                      " Если снять галочку, предупредить всех нужно будет вам."}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="delete-confirm">
                Чтобы подтвердить, введите свою почту: {email}
              </Label>
              <Input
                id="delete-confirm"
                type="email"
                autoComplete="off"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  request.isPending ||
                  confirm.trim().toLowerCase() !== email.toLowerCase()
                }
              >
                Удалить аккаунт
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {access.dialog}
    </>
  );
}

/** Deleting the account: what goes, what stays, by when, and how to come back. */
export function DeleteAccountSection({ email }: { email: string }) {
  const status = useQuery(orpc.account.deletionStatus.queryOptions());
  const [open, setOpen] = useState(false);

  if (status.isError) return <ErrorState onRetry={() => status.refetch()} />;
  if (status.isPending) return <Skeleton className="h-32 w-full" />;
  // Owners of a practice only, for now (see `account.requestDeletion`).
  if (status.data.practices.length === 0) return null;

  const { pending, practices, graceDays } = status.data;
  const paid = practices.reduce((sum, p) => sum + p.paidCredits, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold tracking-tight">
          Удалить аккаунт
        </h2>
        <p className="text-sm text-muted-foreground">
          Без звонков и писем в поддержку. Перед удалением лучше скачать архив:
          потом данные вернуть не получится.
        </p>
      </div>

      {pending ? (
        <Alert variant="warning">
          <CircleAlertIcon />
          <AlertTitle>
            Аккаунт будет удалён {formatDate(pending.purgeAt)}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              Если восстановить аккаунт, страница записи откроется снова.
              Отменённые записи вернуть не получится, а автопродление «Про»
              нужно будет включить заново при оплате.
            </span>
            <RestoreButton />
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Что произойдёт</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
              <li>
                Сразу: закроется страница записи, остановятся напоминания и
                отключится автопродление «Про».
              </li>
              <li>{graceDays} дней аккаунт можно восстановить в один клик.</li>
              <li>
                Затем безвозвратно удалим аккаунт и практики (
                {practices
                  .map((p) => `«${p.name}», клиентов: ${p.clients}`)
                  .join("; ")}
                ) с записями, балансами и файлами. Адрес страницы записи год
                никто не сможет занять.
              </li>
              <li>
                Останутся только сведения об оплатах тарифа: их мы обязаны
                хранить по закону, но уже без вашего имени и почты.
              </li>
              {status.data.clientElsewhere > 0 && (
                <li>
                  Вы записывались к другим специалистам. Их записи с вами и ваш
                  баланс останутся у них: это их данные о клиенте. Чтобы удалить
                  их, обратитесь к этим специалистам.
                </li>
              )}
            </ul>
            {paid > 0 && (
              <Alert variant="warning">
                <CircleAlertIcon />
                <AlertTitle>
                  У клиентов есть оплаченные занятия: {paid}
                </AlertTitle>
                <AlertDescription>
                  Клиенты платили вам напрямую, поэтому вернуть деньги, если это
                  нужно, можно только через ЮKassa или Т-Банк. Договоритесь с
                  клиентами заранее.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => setOpen(true)}>
              <Trash2Icon />
              Удалить аккаунт
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href="#archive" />}
            >
              <DownloadIcon />
              Сначала скачать данные
            </Button>
          </div>
          <DeleteDialog
            status={status.data}
            email={email}
            open={open}
            onClose={() => setOpen(false)}
          />
        </>
      )}
    </section>
  );
}

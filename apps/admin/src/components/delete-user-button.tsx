"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Input,
} from "@synoro/ui";
import { useState, useTransition } from "react";

import { deleteUser } from "~/app/(admin)/users/[id]/actions";

/**
 * Deleting an account is for good, and takes the practices the user owns
 * with it: the admin types the user's email to confirm.
 */
export function DeleteUserButton({
  id,
  email,
  ownedPractices,
}: {
  id: string;
  email: string;
  ownedPractices: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        setConfirm("");
        setError(null);
      }}
    >
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        Удалить пользователя
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
          <AlertDialogDescription>
            Аккаунт, входы, подписка «Про» и членство в практиках будут удалены
            безвозвратно.
            {ownedPractices > 0 &&
              ` Вместе с ним удалятся практики, которыми он владеет (${ownedPractices}), со всеми записями.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          id="delete-user"
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!matches || pending) return;
            setError(null);
            startTransition(async () => {
              try {
                const result = await deleteUser(id, confirm);
                // On success the action redirects; only a refusal returns.
                setError(result.error);
              } catch {
                // The reply may be lost after the user is already gone.
                setError(
                  "Не удалось получить ответ. Обновите страницу и проверьте, удалён ли пользователь, прежде чем повторять.",
                );
              }
            });
          }}
        >
          <label htmlFor="delete-user-confirm" className="text-sm">
            Для подтверждения введите почту <b>{email}</b>
          </label>
          <Input
            id="delete-user-confirm"
            type="email"
            autoComplete="off"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Отмена</AlertDialogCancel>
          <Button
            type="submit"
            form="delete-user"
            variant="destructive"
            disabled={!matches || pending}
          >
            {pending ? "Удаляем…" : "Удалить навсегда"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

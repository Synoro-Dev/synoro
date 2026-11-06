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
  PasswordInput,
  toast,
} from "@synoro/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { orpc } from "~/orpc/react";

/**
 * «Подтвердите, что это вы»: the password if the account has one, a mailed code
 * otherwise or if forgotten. Remounted for each ask, so it starts empty.
 */
function DataAccessForm({
  onConfirmed,
  onClose,
}: {
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const overview = useQuery(orpc.data.overview.queryOptions());
  const hasPassword = overview.data?.access.hasPassword ?? false;
  const [byCode, setByCode] = useState(false);
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);

  const sendCode = useMutation({
    ...orpc.data.sendAccessCode.mutationOptions(),
    onSuccess: () => {
      setSent(true);
      setByCode(true);
      setValue("");
    },
    onError: (error) => toast.error(error.message),
  });
  const confirm = useMutation({
    ...orpc.data.confirmAccess.mutationOptions(),
    onSuccess: onConfirmed,
    onError: (error) => toast.error(error.message),
  });

  const usingCode = byCode || !hasPassword;

  function submit(event: FormEvent) {
    event.preventDefault();
    confirm.mutate(usingCode ? { code: value } : { password: value });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Подтвердите, что это вы</DialogTitle>
        <DialogDescription>
          Здесь данные ваших клиентов, поэтому просим подтвердить вход ещё раз.
          На следующие 15 минут этого хватит.
        </DialogDescription>
      </DialogHeader>

      {usingCode ? (
        <div className="flex flex-col gap-2">
          {sent ? (
            <>
              <Label htmlFor="data-access-code">Код из письма</Label>
              <Input
                id="data-access-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                autoFocus
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Отправим код на почту вашего аккаунта.
            </p>
          )}
          <div>
            <Button
              type="button"
              variant={sent ? "ghost" : "outline"}
              size="sm"
              disabled={sendCode.isPending}
              onClick={() => sendCode.mutate()}
            >
              {sent ? "Отправить код ещё раз" : "Отправить код"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="data-access-password">Пароль</Label>
          <PasswordInput
            id="data-access-password"
            autoComplete="current-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
          />
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={sendCode.isPending}
              onClick={() => sendCode.mutate()}
            >
              Войти по коду из письма
            </Button>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button
          type="submit"
          disabled={confirm.isPending || !value || (usingCode && !sent)}
        >
          Подтвердить
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Runs what needs a confirmed owner: on `ACCESS_REQUIRED` asks for the password
 * or a code, then tries again. Render `dialog` once, call `onError` from the
 * mutation with a way to retry it.
 */
export function useDataAccess() {
  const [retry, setRetry] = useState<(() => void) | null>(null);

  return {
    onError(error: Error, again: () => void) {
      // Each mutation has its own errors; this one is on all of them.
      if ((error as Error & { code?: string }).code === "ACCESS_REQUIRED") {
        setRetry(() => again);
      } else {
        toast.error(error.message);
      }
    },
    dialog: (
      <Dialog
        open={retry !== null}
        onOpenChange={(open) => !open && setRetry(null)}
      >
        <DialogContent className="sm:max-w-sm">
          {retry && (
            <DataAccessForm
              onClose={() => setRetry(null)}
              onConfirmed={() => {
                retry();
                setRetry(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    ),
  };
}

/** Hands text to the browser as a file; nothing of it reaches the page. */
export function saveTextFile(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

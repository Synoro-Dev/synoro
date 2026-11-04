"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
} from "@synoro/ui";
import { type AccountFormValues, accountFormSchema } from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { orpc } from "~/orpc/react";
import { SaveState } from "./save-state";

export function AccountForm({
  initialData,
}: {
  initialData?: Partial<AccountFormValues>;
}) {
  const queryClient = useQueryClient();

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: initialData || {
      name: "",
    },
  });

  const [savedAt, setSavedAt] = useState<number | null>(null);

  const updateAccount = useMutation({
    ...orpc.user.updateAccount.mutationOptions(),
    onSuccess: async (_, data) => {
      form.reset(data);
      setSavedAt(Date.now());
      toast.success("Аккаунт успешно обновлён");
      await queryClient.invalidateQueries({
        queryKey: orpc.user.key(),
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Не удалось обновить аккаунт");
    },
  });

  function onSubmit(data: AccountFormValues) {
    updateAccount.mutate(data);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* Locked while saving: an edit made meanwhile would be reset away. */}
        <fieldset disabled={updateAccount.isPending} className="space-y-6">
          {/* Name Field */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-medium">
                  Имя
                </FormLabel>
                <Input placeholder="Ваше имя" {...field} />
                <p className="text-sm text-amber-700/70">
                  Это имя будет отображаться в вашем профиле и в письмах.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              className="bg-foreground text-background hover:bg-foreground/90"
              disabled={updateAccount.isPending}
            >
              {updateAccount.isPending ? "Обновление…" : "Обновить аккаунт"}
            </Button>
            <SaveState dirty={form.formState.isDirty} savedAt={savedAt} />
          </div>
        </fieldset>
      </form>
    </Form>
  );
}

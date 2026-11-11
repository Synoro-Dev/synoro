"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { paths } from "@synoro/config";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  PasswordInput,
} from "@synoro/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { authClient } from "~/auth/client";

/** Better Auth's default `maxPasswordLength`. */
const MAX_PASSWORD = 128;

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Пароль — не короче 8 символов")
      .max(MAX_PASSWORD, `Пароль — не длиннее ${MAX_PASSWORD} символов`),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
  });

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm({
  ...props
}: React.ComponentProps<typeof Card>) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  // The toast fades away, so it carries the way to a fresh link.
  const showLinkError = () =>
    toast.error(
      "Не удалось сохранить пароль. Возможно, ссылка устарела — запросите новую.",
      {
        action: {
          label: "Запросить новую ссылку",
          onClick: () => router.push(paths.auth.forgotPassword),
        },
      },
    );

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) {
      toast.error("Ссылка больше не работает. Запросите новую.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await authClient.resetPassword({
        newPassword: data.password,
        token,
      });
      if (error) {
        if (error.code === "PASSWORD_TOO_LONG") {
          toast.error(
            `Пароль слишком длинный — не больше ${MAX_PASSWORD} символов.`,
          );
        } else {
          showLinkError();
        }
        return;
      }
      toast.success("Новый пароль сохранён. Теперь войдите.");
      router.push(paths.auth.login);
    } catch (_error) {
      showLinkError();
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Card {...props}>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Ссылка больше не работает</CardTitle>
          <CardDescription>
            Она устарела или уже использована. Запросите новую — это займёт
            минуту.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            render={<Link href={paths.auth.forgotPassword} />}
            className="w-full"
          >
            Запросить новую ссылку
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card {...props}>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Новый пароль</CardTitle>
        <CardDescription>
          Придумайте пароль — не короче 8 символов.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Новый пароль</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="••••••••"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Повторите пароль</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="••••••••"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Сохранение…" : "Сохранить пароль"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

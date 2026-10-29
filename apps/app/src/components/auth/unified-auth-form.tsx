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
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  PasswordInput,
} from "@synoro/ui";
import {
  type LoginFormData,
  loginFormSchema,
  type OTPFormData,
  otpFormSchema,
} from "@synoro/validators";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { authClient } from "~/auth/client";

const emailPasswordSchema = z.object({
  email: z.email("Некорректный адрес электронной почты"),
  password: z.string().min(8, "Пароль должен содержать не менее 8 символов"),
});

type EmailPasswordData = z.infer<typeof emailPasswordSchema>;

/** Seconds before another code can be requested. */
const RESEND_COOLDOWN = 60;

const AUTH_ERRORS: Record<string, string> = {
  INVALID_OTP: "Неверный код. Проверьте письмо и попробуйте ещё раз.",
  OTP_EXPIRED: "Срок действия кода истёк. Запросите новый.",
  TOO_MANY_ATTEMPTS: "Слишком много попыток. Запросите новый код.",
  INVALID_EMAIL_OR_PASSWORD: "Неверный адрес почты или пароль.",
  USER_ALREADY_EXISTS:
    "Аккаунт с этой почтой уже есть. Войдите по коду из письма.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "Аккаунт с этой почтой уже есть. Войдите по коду из письма.",
};

/** Better Auth answers in English: show its known errors in Russian. */
function authErrorMessage(
  error: { code?: string; status: number },
  fallback: string,
) {
  if (error.status === 429) {
    return "Слишком много запросов. Подождите минуту и попробуйте снова.";
  }
  return (error.code && AUTH_ERRORS[error.code]) || fallback;
}

/**
 * Where to go once signed in: home, which sends on by role. The landing's
 * «Про» buttons link here with `?plan=pro`; home then opens practice
 * creation (or billing, if there is a practice already).
 */
function homeAfterAuth(): Route {
  const plan = new URLSearchParams(window.location.search).get("plan");
  return plan === "pro"
    ? `${paths.dashboard.root}?plan=pro`
    : paths.dashboard.root;
}

/**
 * Sign-in and sign-up. The main way in is a 6-digit code mailed to the
 * address (it also creates the account); the password form is secondary.
 */
export function UnifiedAuthForm({
  mode = "signin",
  ...props
}: React.ComponentProps<typeof Card> & {
  mode?: "signin" | "signup";
}) {
  const signup = mode === "signup";
  const [method, setMethod] = useState<"code" | "password">("code");
  // The address the last code went to; set means "enter the code" step.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const router = useRouter();

  const emailForm = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: "" },
  });

  const codeForm = useForm<OTPFormData>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { otp: "" },
  });

  const passwordForm = useForm<EmailPasswordData>({
    resolver: zodResolver(emailPasswordSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendCode = async (email: string) => {
    setLoading(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (error) {
        toast.error(
          authErrorMessage(
            error,
            "Не удалось отправить код. Попробуйте ещё раз.",
          ),
        );
        return;
      }
      codeForm.reset();
      setSentTo(email);
      setCountdown(RESEND_COOLDOWN);
    } catch (_error) {
      toast.error("Не удалось отправить код. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  };

  const onEmailSubmit = (data: LoginFormData) => sendCode(data.email);

  const onCodeSubmit = async (data: OTPFormData) => {
    // The code input stays enabled while checking, so a retry after a wrong
    // code keeps focus; guard against a second submit here instead.
    if (!sentTo || loading) return;
    setLoading(true);
    try {
      const { error } = await authClient.signIn.emailOtp({
        email: sentTo,
        otp: data.otp,
      });
      if (error) {
        codeForm.reset();
        toast.error(authErrorMessage(error, "Не удалось войти по коду."));
        return;
      }
      router.push(homeAfterAuth());
    } catch (_error) {
      toast.error("Не удалось войти по коду. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  };

  const onPasswordSubmit = async (data: EmailPasswordData) => {
    setLoading(true);
    try {
      const { error } = signup
        ? await authClient.signUp.email({
            email: data.email,
            password: data.password,
            name: data.email.split("@")[0] ?? "Пользователь",
          })
        : await authClient.signIn.email({
            email: data.email,
            password: data.password,
          });
      if (error) {
        toast.error(
          authErrorMessage(
            error,
            signup
              ? "Не удалось создать аккаунт. Попробуйте ещё раз."
              : "Неверный адрес почты или пароль.",
          ),
        );
        return;
      }
      router.push(homeAfterAuth());
    } catch (_error) {
      toast.error(
        signup
          ? "Не удалось создать аккаунт. Попробуйте ещё раз."
          : "Неверный адрес почты или пароль.",
      );
    } finally {
      setLoading(false);
    }
  };

  // The typed address follows the user between the two methods.
  const switchToPassword = () => {
    passwordForm.setValue("email", emailForm.getValues("email"));
    setMethod("password");
  };

  const switchToCode = () => {
    emailForm.setValue("email", passwordForm.getValues("email"));
    setSentTo(null);
    setMethod("code");
  };

  const title = sentTo
    ? "Введите код"
    : signup
      ? "Создать аккаунт"
      : "С возвращением";

  return (
    <Card {...props}>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>
          {method === "password" ? (
            signup ? (
              "Зарегистрируйтесь с паролем"
            ) : (
              "Войдите с паролем"
            )
          ) : sentTo ? (
            <>
              Отправили 6-значный код на{" "}
              <span className="font-medium text-foreground">{sentTo}</span>. Он
              действует 10 минут.
            </>
          ) : signup ? (
            "Пришлём на почту 6-значный код — пароль не нужен"
          ) : (
            "Пришлём на почту 6-значный код для входа"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {method === "code" && sentTo ? (
            <Form {...codeForm}>
              <form
                onSubmit={codeForm.handleSubmit(onCodeSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={codeForm.control}
                  name="otp"
                  render={({ field }) => (
                    <FormItem className="items-center">
                      <FormLabel className="sr-only">Код из письма</FormLabel>
                      <FormControl>
                        <InputOTP
                          maxLength={6}
                          pattern="^\d+$"
                          autoFocus
                          containerClassName="justify-center"
                          onComplete={() =>
                            codeForm.handleSubmit(onCodeSubmit)()
                          }
                          {...field}
                        >
                          <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                            <InputOTPSlot index={3} />
                            <InputOTPSlot index={4} />
                            <InputOTPSlot index={5} />
                          </InputOTPGroup>
                        </InputOTP>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Проверка…" : "Подтвердить"}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => setSentTo(null)}
                    className="text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Изменить почту
                  </button>
                  <button
                    type="button"
                    onClick={() => sendCode(sentTo)}
                    disabled={countdown > 0 || loading}
                    className="text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                  >
                    {countdown > 0
                      ? `Отправить снова через ${countdown} с`
                      : "Отправить код снова"}
                  </button>
                </div>
              </form>
            </Form>
          ) : method === "code" ? (
            <Form {...emailForm}>
              <form
                onSubmit={emailForm.handleSubmit(onEmailSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={emailForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Электронная почта</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="m@example.com"
                          autoComplete="email"
                          spellCheck={false}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Отправка кода…" : "Получить код"}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="w-full"
                  onClick={switchToPassword}
                >
                  {signup ? "Зарегистрироваться с паролем" : "Войти с паролем"}
                </Button>
              </form>
            </Form>
          ) : (
            <Form {...passwordForm}>
              <form
                onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={passwordForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Электронная почта</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="m@example.com"
                          autoComplete="email"
                          spellCheck={false}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={passwordForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Пароль</FormLabel>
                        {!signup && (
                          <Link
                            href={paths.auth.forgotPassword}
                            className="text-sm text-primary underline-offset-4 hover:underline"
                          >
                            Забыли пароль?
                          </Link>
                        )}
                      </div>
                      <FormControl>
                        <PasswordInput
                          placeholder="••••••••"
                          autoComplete={
                            signup ? "new-password" : "current-password"
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading
                    ? signup
                      ? "Создание аккаунта…"
                      : "Вход…"
                    : signup
                      ? "Создать аккаунт"
                      : "Войти"}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="w-full"
                  onClick={switchToCode}
                >
                  {signup
                    ? "Зарегистрироваться по коду из письма"
                    : "Войти по коду из письма"}
                </Button>
              </form>
            </Form>
          )}

          {!sentTo && (
            <div className="text-center text-sm">
              {signup ? (
                <>
                  Уже есть аккаунт?{" "}
                  <Link
                    href={paths.auth.login}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Войти
                  </Link>
                </>
              ) : (
                <>
                  Нет аккаунта?{" "}
                  <Link
                    href={paths.auth.signup}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Зарегистрироваться
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

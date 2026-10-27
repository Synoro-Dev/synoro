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
      router.push(paths.dashboard.root);
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
      router.push(paths.dashboard.root);
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
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Или
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => authClient.signIn.social({ provider: "google" })}
              >
                <GoogleLogo />
                Продолжить через Google
              </Button>

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
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GoogleLogo() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

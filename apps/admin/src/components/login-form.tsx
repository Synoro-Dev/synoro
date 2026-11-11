"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
} from "@synoro/ui";
import {
  type LoginFormData,
  loginFormSchema,
  type OTPFormData,
  otpFormSchema,
} from "@synoro/validators";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { authClient } from "~/auth/client";

/**
 * Sign-in by a code from the mail, nothing else. The server mails codes to
 * admins only, so the form can't tell anyone whether an address is one.
 */
export function LoginForm() {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailForm = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: "" },
  });
  const codeForm = useForm<OTPFormData>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { otp: "" },
  });

  const sendCode = async ({ email }: LoginFormData) => {
    setLoading(true);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    setLoading(false);
    if (error) {
      toast.error("Не удалось отправить код. Попробуйте ещё раз.");
      return;
    }
    codeForm.reset();
    setSentTo(email);
  };

  const signIn = async ({ otp }: OTPFormData) => {
    if (!sentTo || loading) return;
    setLoading(true);
    const { error } = await authClient.signIn.emailOtp({ email: sentTo, otp });
    setLoading(false);
    if (error) {
      codeForm.reset();
      toast.error("Неверный или просроченный код.");
      return;
    }
    router.replace("/");
  };

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Админка Synoro</CardTitle>
        <CardDescription>
          {sentTo ? (
            <>
              Если <span className="text-foreground font-medium">{sentTo}</span>{" "}
              — администратор, код уже в почте. Он действует 10 минут.
            </>
          ) : (
            "Пришлём код для входа на почту администратора"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sentTo ? (
          <Form {...codeForm}>
            <form
              onSubmit={codeForm.handleSubmit(signIn)}
              className="flex flex-col gap-4"
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
                        onComplete={() => codeForm.handleSubmit(signIn)()}
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
              <Button type="submit" disabled={loading}>
                {loading ? "Проверка…" : "Войти"}
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={() => setSentTo(null)}
              >
                Другая почта
              </Button>
            </form>
          </Form>
        ) : (
          <Form {...emailForm}>
            <form
              onSubmit={emailForm.handleSubmit(sendCode)}
              className="flex flex-col gap-4"
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
                        autoComplete="email"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={loading}>
                {loading ? "Отправляем…" : "Получить код"}
              </Button>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}

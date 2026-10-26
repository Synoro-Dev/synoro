"use client";

import { paths } from "@acme/config";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  toast,
} from "@acme/ui";
import { type PracticeFormValues, practiceFormSchema } from "@acme/validators";
import { zodResolver } from "@hookform/resolvers/zod";
import { isDefinedError } from "@orpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { orpc } from "~/orpc/react";

/** Start a practice: the signed-in user becomes its owner (specialist). */
export function CreatePracticeForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<PracticeFormValues>({
    resolver: zodResolver(practiceFormSchema),
    defaultValues: { name: "", slug: "" },
  });
  const { errors } = form.formState;

  const create = useMutation({
    ...orpc.practice.create.mutationOptions(),
    onSuccess: async (practice) => {
      toast.success("Практика создана");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      router.push(paths.booking.practice(practice.id));
    },
    onError: (error) => {
      if (isDefinedError(error) && error.code === "CONFLICT") {
        form.setError(error.data.field, { message: error.message });
        return;
      }
      toast.error(error.message || "Не удалось создать практику");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Новая практика</CardTitle>
        <CardDescription>
          Для специалиста: своё расписание, клиенты и страница записи.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="practice-name">Название</Label>
            <Input
              id="practice-name"
              placeholder="Анна Иванова, психолог"
              aria-invalid={!!errors.name}
              {...form.register("name")}
            />
            {errors.name && (
              <p role="alert" className="text-sm text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="practice-slug">Адрес страницы записи</Label>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span>/p/</span>
              <Input
                id="practice-slug"
                placeholder="anna"
                aria-invalid={!!errors.slug}
                {...form.register("slug")}
              />
            </div>
            {errors.slug && (
              <p role="alert" className="text-sm text-destructive">
                {errors.slug.message}
              </p>
            )}
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Создание…" : "Создать"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

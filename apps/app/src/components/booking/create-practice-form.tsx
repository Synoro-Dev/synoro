"use client";

import { paths } from "@synoro/config";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  toast,
} from "@synoro/ui";
import { type PracticeFormValues, practiceFormSchema } from "@synoro/validators";
import { zodResolver } from "@hookform/resolvers/zod";
import { isDefinedError } from "@orpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { orpc } from "~/orpc/react";

/** Latin slug suggestion from a (possibly Cyrillic) practice name. */
const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function suggestSlug(name: string) {
  return name
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Start a practice: the signed-in user becomes its owner (specialist). */
export function CreatePracticeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<PracticeFormValues>({
    resolver: zodResolver(practiceFormSchema),
    defaultValues: { name: "", slug: "" },
  });
  const { errors, dirtyFields } = form.formState;

  const create = useMutation({
    ...orpc.practice.create.mutationOptions(),
    onSuccess: async (practice) => {
      toast.success("Практика создана");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      form.reset();
      router.push(paths.booking.schedule(practice.id));
      // The sidebar's practice list is rendered on the server.
      router.refresh();
    },
    onError: (error) => {
      if (isDefinedError(error) && error.code === "CONFLICT") {
        form.setError(error.data.field, { message: error.message });
        return;
      }
      toast.error(error.message || "Не удалось создать практику");
    },
  });

  const nameField = form.register("name", {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!dirtyFields.slug) {
        form.setValue("slug", suggestSlug(e.target.value));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          className="flex flex-col gap-5"
        >
          <DialogHeader>
            <DialogTitle>Новая практика</DialogTitle>
            <DialogDescription>
              Своё расписание, клиенты и страница записи.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="practice-name">Название</Label>
            <Input
              id="practice-name"
              autoFocus
              placeholder="Анна Иванова, психолог"
              aria-invalid={!!errors.name}
              {...nameField}
            />
            {errors.name && (
              <p role="alert" className="text-sm text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="practice-slug">Адрес страницы записи</Label>
            <InputGroup aria-invalid={!!errors.slug}>
              <InputGroupAddon>/p/</InputGroupAddon>
              <InputGroupInput
                id="practice-slug"
                placeholder="anna"
                aria-invalid={!!errors.slug}
                {...form.register("slug")}
              />
            </InputGroup>
            {errors.slug && (
              <p role="alert" className="text-sm text-destructive">
                {errors.slug.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

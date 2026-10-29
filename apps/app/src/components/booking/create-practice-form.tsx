"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isDefinedError } from "@orpc/client";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@synoro/ui";
import {
  PROFESSION_TERMS,
  PROFESSIONS,
  type PracticeFormValues,
  practiceFormSchema,
} from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";

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

const PROFESSION_LABELS = Object.fromEntries(
  PROFESSIONS.map((p) => [p, PROFESSION_TERMS[p].label]),
);

/**
 * Start a practice: the signed-in user becomes its owner (specialist). Then
 * on to its schedule, or to «Про» billing (`next="billing"`) when the
 * specialist signed up for «Про».
 */
export function CreatePracticeDialog({
  open,
  onOpenChange,
  next = "schedule",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  next?: "schedule" | "billing";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<PracticeFormValues>({
    resolver: zodResolver(practiceFormSchema),
    defaultValues: { name: "", slug: "", profession: undefined },
  });
  const { errors, dirtyFields } = form.formState;
  const profession = useWatch({ control: form.control, name: "profession" });

  const create = useMutation({
    ...orpc.practice.create.mutationOptions(),
    onSuccess: async (practice) => {
      toast.success("Практика создана");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      form.reset();
      router.push(
        next === "billing"
          ? paths.settings.billing
          : paths.booking.schedule(practice.id),
      );
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
              placeholder="Анна Иванова"
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
            <Label htmlFor="practice-profession">Чем вы занимаетесь</Label>
            <Select
              items={PROFESSION_LABELS}
              value={profession ?? null}
              onValueChange={(value) =>
                form.setValue(
                  "profession",
                  value as PracticeFormValues["profession"],
                  { shouldValidate: true },
                )
              }
            >
              <SelectTrigger
                id="practice-profession"
                className="w-full"
                aria-invalid={!!errors.profession}
              >
                <SelectValue placeholder="Выберите" />
              </SelectTrigger>
              <SelectContent>
                {PROFESSIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROFESSION_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.profession ? (
              <p role="alert" className="text-sm text-destructive">
                {errors.profession.message}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                От этого зависит, как страница записи называет встречи:
                консультации, занятия, приёмы.
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

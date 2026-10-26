import { z } from "zod";

/** Free consultations sit on a 30-minute grid, so schedules do too. */
const halfHourMinute = (max: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(max)
    .refine((m) => m % 30 === 0, "Время должно быть кратно 30 минутам");

export const practiceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Название должно содержать не менее 2 символов")
    .max(120, "Название не должно быть длиннее 120 символов"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Адрес должен содержать не менее 3 символов")
    .max(48, "Адрес не должен быть длиннее 48 символов")
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Только латинские буквы, цифры и дефис (не в начале и не в конце)",
    ),
});

export type PracticeFormValues = z.infer<typeof practiceFormSchema>;

export const availabilityRuleSchema = z
  .object({
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: z.number().int().min(1).max(7),
    startMinute: halfHourMinute(1410),
    endMinute: halfHourMinute(1440),
  })
  .refine((r) => r.startMinute < r.endMinute, {
    message: "Конец интервала должен быть позже начала",
    path: ["endMinute"],
  });

export type AvailabilityRuleValues = z.infer<typeof availabilityRuleSchema>;

export const availabilityFormSchema = z.object({
  rules: z
    .array(availabilityRuleSchema)
    .max(50, "Не больше 50 интервалов")
    .refine(
      (rules) =>
        rules.every((a, i) =>
          rules.every(
            (b, j) =>
              i === j ||
              a.weekday !== b.weekday ||
              a.endMinute <= b.startMinute ||
              b.endMinute <= a.startMinute,
          ),
        ),
      "Интервалы одного дня не должны пересекаться",
    ),
});

export type AvailabilityFormValues = z.infer<typeof availabilityFormSchema>;

export const creditGrantFormSchema = z.object({
  delta: z
    .number({ message: "Введите число" })
    .int("Только целое число")
    .min(-100, "Не меньше −100")
    .max(100, "Не больше 100")
    .refine((n) => n !== 0, "Количество не может быть нулём"),
  note: z.string().trim().max(500).optional(),
});

export type CreditGrantFormValues = z.infer<typeof creditGrantFormSchema>;

export const freeConsultationFormSchema = z.object({
  guestName: z
    .string()
    .trim()
    .min(1, "Укажите имя")
    .max(120, "Имя не должно быть длиннее 120 символов"),
  guestContact: z
    .string()
    .trim()
    .max(120, "Контакт не должен быть длиннее 120 символов")
    .optional(),
  note: z.string().trim().max(500).optional(),
});

export type FreeConsultationFormValues = z.infer<
  typeof freeConsultationFormSchema
>;

export const memberInviteFormSchema = z.object({
  email: z.email("Некорректный адрес электронной почты"),
  role: z.enum(["admin", "client"]),
});

export type MemberInviteFormValues = z.infer<typeof memberInviteFormSchema>;

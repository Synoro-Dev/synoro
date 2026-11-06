import { z } from "zod";

/**
 * Services of a practice (`services` table): what a client books, how long it
 * lasts and what it costs in credits. The picker offers the lengths people
 * actually use; the database accepts any multiple of 5 from 15 to 240.
 */

export const SERVICE_MINUTES = [30, 45, 50, 60, 75, 90, 120, 150, 180] as const;

export const SERVICE_MAX = 8;
export const SERVICE_CREDITS_MAX = 10;

export const serviceSchema = z.object({
  /** Missing for a service that is new. */
  id: z.uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Назовите услугу")
    .max(80, "Не длиннее 80 символов"),
  minutes: z
    .number()
    .int()
    .min(15, "Не короче 15 минут")
    .max(240, "Не длиннее 4 часов")
    .refine((m) => m % 5 === 0, "Длительность кратна 5 минутам"),
  credits: z
    .number()
    .int()
    .min(1, "Не меньше одного занятия")
    .max(SERVICE_CREDITS_MAX, `Не больше ${SERVICE_CREDITS_MAX}`),
  active: z.boolean().default(true),
});

export const servicesFormSchema = z.object({
  /** In the order they are shown. At least one stays switched on. */
  services: z
    .array(serviceSchema)
    .min(1, "Нужна хотя бы одна услуга")
    .max(SERVICE_MAX, `Не больше ${SERVICE_MAX} услуг`)
    .refine(
      (services) => services.some((s) => s.active),
      "Хотя бы одна услуга должна быть включена",
    ),
});

export type ServiceInput = z.infer<typeof serviceSchema>;
export type ServicesFormValues = z.infer<typeof servicesFormSchema>;

/**
 * Where slots of a service may start: on the hour for whole hours and for
 * «hour with a break» lengths (46–60 minutes: 50 + 10), on the half hour
 * otherwise. Every practice with one 60-minute service behaves as before.
 */
export function serviceStepMinutes(minutes: number) {
  return minutes % 60 === 0 || (minutes >= 46 && minutes <= 60) ? 60 : 30;
}

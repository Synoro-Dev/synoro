import { z } from "zod";

// Login form validation schema
export const loginFormSchema = z.object({
  email: z
    .string()
    .min(1, "Введите адрес электронной почты")
    .email("Проверьте адрес почты — похоже, в нём опечатка"),
});

export type LoginFormData = z.infer<typeof loginFormSchema>;

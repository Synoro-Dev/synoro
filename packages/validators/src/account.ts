import { z } from "zod";

export const accountFormSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Имя должно содержать не менее 2 символов." })
    .max(30, { message: "Имя не должно быть длиннее 30 символов." }),
});

export type AccountFormValues = z.infer<typeof accountFormSchema>;

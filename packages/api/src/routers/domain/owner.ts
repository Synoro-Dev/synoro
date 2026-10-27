import { practiceProcedure } from "../../lib/practice-access";

/** Domains are the owner's branding: administrators can't change them. */
export const ownerProcedure = practiceProcedure.errors({
  FORBIDDEN: { message: "Домен страницы может менять только владелец" },
});

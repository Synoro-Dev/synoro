import { practiceProcedure } from "../../lib/practice-access";

/** The calendar is the specialist's own account: administrators can't link it. */
export const ownerProcedure = practiceProcedure.errors({
  FORBIDDEN: {
    message: "Google Календарь подключает только владелец практики",
  },
});

import { adminPaymentsRouter } from "./payments";
import { adminPracticesRouter } from "./practices";
import { adminStatsRouter } from "./stats";
import { adminUsersRouter } from "./users";

/** Everything admin.synoro.ru (apps/admin) reads; `adminProcedure` only. */
export const adminRouter = {
  users: adminUsersRouter,
  practices: adminPracticesRouter,
  payments: adminPaymentsRouter,
  stats: adminStatsRouter,
};

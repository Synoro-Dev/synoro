import { adminPaymentsRouter } from "./payments";
import { adminPracticesRouter } from "./practices";
import { adminSignInsRouter } from "./sign-ins";
import { adminStatsRouter } from "./stats";
import { adminUsersRouter } from "./users";

/** Everything admin.synoro.ru (apps/admin) reads; `adminProcedure` only. */
export const adminRouter = {
  users: adminUsersRouter,
  practices: adminPracticesRouter,
  payments: adminPaymentsRouter,
  signIns: adminSignInsRouter,
  stats: adminStatsRouter,
};

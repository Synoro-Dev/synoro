import { checkAccountPassword } from "@synoro/auth/password";
import { recordDataAudit } from "@synoro/jobs/data-export";
import { z } from "zod";

import {
  checkAccessCode,
  dataProcedure,
  grantAccess,
} from "../../lib/data-access";

/**
 * Prove it's the owner, with the password or a mailed code. Lasts 15 minutes
 * in this session.
 *
 * @example client.data.confirmAccess({ code: "123456" })
 */
export const confirmAccess = dataProcedure
  .errors({
    WRONG_PASSWORD: { message: "Неверный пароль" },
    WRONG_CODE: { message: "Неверный или устаревший код" },
  })
  .input(
    z.union([
      z.object({ password: z.string().min(1).max(128) }),
      z.object({ code: z.string().trim().length(6) }),
    ]),
  )
  .handler(async ({ context, input, errors }) => {
    const { session, user } = context.session;
    if ("password" in input) {
      const right = await checkAccountPassword(
        context.db,
        user.id,
        input.password,
      );
      if (!right) throw errors.WRONG_PASSWORD();
    } else if (!(await checkAccessCode(context.db, session.id, input.code))) {
      throw errors.WRONG_CODE();
    }

    await grantAccess(context.db, session.id);
    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      action: "access_confirmed",
      details: { by: "password" in input ? "password" : "code" },
    });
    return { fresh: true };
  });

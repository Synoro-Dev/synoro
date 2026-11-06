import { dispatchEmail } from "@synoro/jobs";

import { dataProcedure, issueAccessCode } from "../../lib/data-access";

/**
 * Mail the code that confirms access, to the account's own address. For people
 * without a password, or who forgot it.
 *
 * @example client.data.sendAccessCode()
 */
export const sendAccessCode = dataProcedure
  .errors({
    TOO_SOON: {
      message: "Код уже отправлен. Новый можно запросить через минуту",
    },
  })
  .handler(async ({ context, errors }) => {
    const { session, user } = context.session;
    const code = await issueAccessCode(context.db, session.id);
    if (!code) throw errors.TOO_SOON();

    await dispatchEmail({
      template: "data-access-code",
      to: [user.email],
      subject: "Код подтверждения",
      props: { code },
    });
    return { sent: true };
  });

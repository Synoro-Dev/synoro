import {
  isCleanPractice,
  loadImportFile,
  readArchive,
} from "@synoro/jobs/data-import";
import { z } from "zod";

import { dataProcedure } from "../../lib/data-access";
import { findOwnedBatch } from "../../lib/imports";

/**
 * What one practice of an archive would bring, and whether the settings come
 * along: only into a practice with nothing in it yet.
 *
 * @example client.import.previewArchive({ batchId, practiceIndex: 0 })
 */
export const previewArchive = dataProcedure
  .errors({
    NOT_FOUND: { message: "Загрузка не найдена или её срок вышел" },
  })
  .input(
    z.object({ batchId: z.uuid(), practiceIndex: z.number().int().min(0) }),
  )
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const batch = await findOwnedBatch(context.db, input.batchId, user.id);
    const file = batch && (await loadImportFile(context.db, batch.id));
    if (!batch || !file) throw errors.NOT_FOUND();
    const practice = readArchive(file).practices[input.practiceIndex];
    if (!practice) throw errors.NOT_FOUND();

    return {
      clean: await isCleanPractice(context.db, batch.practiceId),
      name: practice.name,
      clients: practice.clients.length + practice.imported_clients.length,
      bookings: practice.bookings.filter((row) => !row.hold_until).length,
      payments: practice.payments.length,
      creditEntries: practice.credit_entries.length,
      hours: practice.working_hours.length,
      packages: practice.packages.length,
      messages: practice.messages.length,
    };
  });

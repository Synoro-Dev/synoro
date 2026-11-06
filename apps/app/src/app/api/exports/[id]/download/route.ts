import { openExportDownload } from "@synoro/api";
import { db } from "@synoro/db";
import { z } from "zod";

const MESSAGES = {
  401: "Войдите в аккаунт, чтобы скачать архив",
  403: "Скачать архив может только его владелец",
  404: "Архив не найден",
  410: "Срок ссылки вышел. Запросите новый архив в настройках",
};

function refuse(status: keyof typeof MESSAGES) {
  return Response.json({ message: MESSAGES[status] }, { status });
}

/**
 * The archive itself, through the app: a signed link to the bucket would work
 * for anyone who got it, this one only for its owner, signed in.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return refuse(404);

  const { auth } = await import("~/auth/server");
  const session = await auth.api.getSession({ headers: request.headers });
  const download = await openExportDownload(db, session, id.data);
  if (download.status !== 200) return refuse(download.status);

  const { getObjectFromS3 } = await import("@synoro/storage");
  const file = await getObjectFromS3(download.key);
  if (!file) return refuse(410);

  return new Response(Buffer.from(file.body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${download.filename}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

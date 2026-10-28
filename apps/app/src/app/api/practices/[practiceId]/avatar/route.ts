import { findOwnerMembership } from "@synoro/api";
import { env, logger, paths } from "@synoro/config";
import { db, eq, Practice } from "@synoro/db";
import { z } from "zod";

/** The browser downsizes to 512 px first, so a real photo is far below this. */
const MAX_BYTES = 1024 * 1024;

const practiceId = z.uuid();

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** JPEG starts with FF D8 FF; the declared content type is not trusted. */
function isJpeg(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** The practice if the caller is signed in as its owner. */
async function authorize(request: Request, rawId: string) {
  const id = practiceId.safeParse(rawId);
  if (!id.success) return undefined;

  const { auth } = await import("~/auth/server");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return undefined;

  const owner = await findOwnerMembership(db, id.data, session.user.id);
  if (!owner) return undefined;

  return db.query.Practice.findFirst({ where: eq(Practice.id, id.data) });
}

function storageConfigured() {
  return !!env.AWS_ACCESS_KEY_ID && !!env.AWS_SECRET_ACCESS_KEY;
}

/**
 * Upload the specialist's photo (multipart, field `file`, a JPEG). Owner only.
 * Replaces the previous photo.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ practiceId: string }> },
) {
  const practice = await authorize(request, (await params).practiceId);
  if (!practice) return json({ message: "Нет доступа к этой практике" }, 403);
  if (!storageConfigured()) {
    return json({ message: "Хранилище файлов не настроено" }, 503);
  }

  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return json({ message: "Нет файла" }, 400);
  if (file.size > MAX_BYTES) {
    return json({ message: "Файл слишком большой" }, 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) {
    return json({ message: "Нужно изображение в формате JPEG" }, 415);
  }

  const { uploadBufferToS3, deleteObjectFromS3 } = await import(
    "@synoro/storage"
  );
  const version = Date.now();
  const key = `practices/${practice.id}/avatar-${version}.jpg`;
  await uploadBufferToS3(key, bytes, "image/jpeg");
  await db
    .update(Practice)
    .set({ image: key })
    .where(eq(Practice.id, practice.id));

  if (practice.image) {
    await deleteObjectFromS3(practice.image).catch((error: unknown) =>
      logger.warn("practice.avatar_cleanup_failed", { error }),
    );
  }

  return json({
    imageUrl: `${paths.booking.avatar(practice.slug)}?v=${version}`,
  });
}

/** Remove the photo; the page falls back to the initial. Owner only. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ practiceId: string }> },
) {
  const practice = await authorize(request, (await params).practiceId);
  if (!practice) return json({ message: "Нет доступа к этой практике" }, 403);

  await db
    .update(Practice)
    .set({ image: null })
    .where(eq(Practice.id, practice.id));

  if (practice.image && storageConfigured()) {
    const { deleteObjectFromS3 } = await import("@synoro/storage");
    await deleteObjectFromS3(practice.image).catch((error: unknown) =>
      logger.warn("practice.avatar_cleanup_failed", { error }),
    );
  }
  return json({ imageUrl: null });
}

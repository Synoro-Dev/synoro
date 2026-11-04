import { env } from "@synoro/config";
import { db, eq, Practice } from "@synoro/db";

/**
 * The specialist's photo on the public booking page. The bucket stays
 * private: the app reads the object and serves it, so the same path works on
 * the main address and on a practice's own host. The page links it with a
 * `?v=` taken from the stored key, which makes a cached copy safe to keep.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const practice = await db.query.Practice.findFirst({
    where: eq(Practice.slug, slug.toLowerCase()),
    columns: { image: true },
  });
  if (!practice?.image || !env.AWS_ACCESS_KEY_ID) {
    return new Response(null, { status: 404 });
  }

  const { getObjectFromS3 } = await import("@synoro/storage");
  const object = await getObjectFromS3(practice.image);
  if (!object) return new Response(null, { status: 404 });

  const versioned = new URL(request.url).searchParams.has("v");
  return new Response(Buffer.from(object.body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": versioned
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300",
    },
  });
}

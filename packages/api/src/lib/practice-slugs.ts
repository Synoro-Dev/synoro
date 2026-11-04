import {
  and,
  type Database,
  eq,
  Practice,
  PracticeSlugAlias,
} from "@synoro/db";

/** The practice a public address leads to: its current one or a former one. */
export async function findPracticeIdBySlug(db: Database, slug: string) {
  const [current] = await db
    .select({ id: Practice.id })
    .from(Practice)
    .where(eq(Practice.slug, slug));
  if (current) return current.id;
  const [former] = await db
    .select({ id: PracticeSlugAlias.practiceId })
    .from(PracticeSlugAlias)
    .where(eq(PracticeSlugAlias.slug, slug));
  return former?.id;
}

/**
 * Give the practice a new address. The old one stays as an alias, so links
 * clients already have keep working and nobody else can take the name.
 */
export async function moveToSlug(
  db: Database,
  practiceId: string,
  slug: string,
) {
  await db.transaction(async (tx) => {
    const [practice] = await tx
      .select({ slug: Practice.slug })
      .from(Practice)
      .where(eq(Practice.id, practiceId))
      .for("update");
    if (!practice || practice.slug === slug) return;

    await tx
      .delete(PracticeSlugAlias)
      .where(
        and(
          eq(PracticeSlugAlias.slug, slug),
          eq(PracticeSlugAlias.practiceId, practiceId),
        ),
      );
    await tx.update(Practice).set({ slug }).where(eq(Practice.id, practiceId));
    await tx
      .insert(PracticeSlugAlias)
      .values({ slug: practice.slug, practiceId })
      .onConflictDoNothing();
  });
}

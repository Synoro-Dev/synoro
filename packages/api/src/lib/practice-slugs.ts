import {
  and,
  type Database,
  eq,
  Practice,
  PracticeSlugAlias,
  sql,
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
 * Hold these addresses until the transaction ends. Whoever checks that a name
 * is free and then writes it holds this lock from the check to the commit: the
 * unique index covers `practices.slug` only, not the aliases. Sorted, so two
 * moves never wait for each other.
 */
export async function lockSlugs(tx: Database, slugs: string[]) {
  for (const slug of [...slugs].sort()) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`practice-slug:${slug}`}))`,
    );
  }
}

/**
 * Give the practice a new address, unless another practice holds it (now or
 * formerly): false then. The old address stays as an alias, so links clients
 * already have keep working and nobody else can take the name.
 */
export async function moveToSlug(
  db: Database,
  practiceId: string,
  slug: string,
) {
  return db.transaction(async (tx) => {
    const [practice] = await tx
      .select({ slug: Practice.slug })
      .from(Practice)
      .where(eq(Practice.id, practiceId))
      .for("update");
    if (!practice) return false;
    if (practice.slug === slug) return true;

    await lockSlugs(tx, [practice.slug, slug]);
    const holder = await findPracticeIdBySlug(tx, slug);
    if (holder && holder !== practiceId) return false;

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
    return true;
  });
}

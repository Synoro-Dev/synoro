import {
  and,
  type Database,
  eq,
  gt,
  Practice,
  PracticeSlugAlias,
  ReservedSlug,
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
 * The address of a deleted practice: closed to everyone for a year, because
 * its clients still have the link.
 */
export async function isSlugReserved(db: Database, slug: string) {
  const [row] = await db
    .select({ slug: ReservedSlug.slug })
    .from(ReservedSlug)
    .where(and(eq(ReservedSlug.slug, slug), gt(ReservedSlug.until, new Date())))
    .limit(1);
  return row !== undefined;
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
    if (await isSlugReserved(tx, slug)) return false;

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

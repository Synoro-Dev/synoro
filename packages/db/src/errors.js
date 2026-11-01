/**
 * Drizzle wraps driver errors (`DrizzleQueryError`); the Postgres SQLSTATE
 * and constraint live on a `cause`. Works for node-postgres and PGlite.
 */
export function findPgError(error) {
    let current = error;
    let innermost = error;
    for (let depth = 0; current && depth < 5; depth++) {
        const candidate = current;
        if (candidate.code)
            return candidate;
        innermost = current;
        current = candidate.cause;
    }
    // No SQLSTATE anywhere (e.g. a dropped connection): the innermost cause
    // says what happened; the wrapper only says which query was running.
    return innermost instanceof Error ? { message: innermost.message } : {};
}
/**
 * True for an exclusion-constraint violation (SQLSTATE 23P01), optionally
 * only for the named constraint, e.g. `bookings_no_overlap`.
 */
export function isExclusionViolation(error, constraint) {
    const pg = findPgError(error);
    if (pg.code !== "23P01")
        return false;
    if (!constraint)
        return true;
    return (pg.constraint ?? pg.message ?? "").includes(constraint);
}
/**
 * True for a unique-constraint violation (SQLSTATE 23505), optionally only
 * for the named constraint, e.g. `users_email_unique`.
 */
export function isUniqueViolation(error, constraint) {
    const pg = findPgError(error);
    if (pg.code !== "23505")
        return false;
    if (!constraint)
        return true;
    // PGlite and node-postgres expose `constraint`; fall back to the message.
    return (pg.constraint ?? pg.message ?? "").includes(constraint);
}

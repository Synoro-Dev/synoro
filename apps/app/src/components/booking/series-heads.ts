/**
 * The nearest booking of each series the client may still cancel with the
 * credit back: the only one that offers cancelling the whole series.
 * `cancelSeries` takes every upcoming booking past the practice's deadline,
 * so none before this one is lost; nearer ones stay — also those a late
 * cancel would allow, which is for one booking at a time. `upcoming` is in
 * time order.
 */
export function seriesHeads(
  upcoming: {
    id: string;
    seriesId: string | null;
    canCancel: boolean;
    lateCancel: boolean;
  }[],
) {
  const heads = new Set<string>();
  const seen = new Set<string>();
  for (const b of upcoming) {
    if (!b.canCancel || b.lateCancel) continue;
    if (!b.seriesId || seen.has(b.seriesId)) continue;
    seen.add(b.seriesId);
    heads.add(b.id);
  }
  return heads;
}

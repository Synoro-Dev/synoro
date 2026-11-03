import { Skeleton } from "@synoro/ui";

export function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {["a", "b", "c", "d", "e", "f"].map((key) => (
        <Skeleton key={key} className="h-10 w-full" />
      ))}
    </div>
  );
}

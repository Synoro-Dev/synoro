import { Button } from "@acme/ui";

export function QueryError({
  message,
  retry,
  isFetching,
}: {
  message: string;
  retry: () => unknown;
  isFetching: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" disabled={isFetching} onClick={retry}>
        Повторить загрузку
      </Button>
    </div>
  );
}

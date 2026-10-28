"use client";

import { ServerError } from "~/components/errors/server-error";

export default function SettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ServerError
      {...props}
      title="Не удалось загрузить настройки"
      variant="inline"
    />
  );
}

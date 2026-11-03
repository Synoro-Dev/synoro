"use client";

import { ServerError } from "~/components/errors/server-error";

export default function ClientError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ServerError {...props} variant="inline" />;
}

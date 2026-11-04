"use client";

import { ServerError } from "~/components/server-error";

export default function RootError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ServerError {...props} />;
}

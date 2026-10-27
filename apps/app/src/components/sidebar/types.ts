import type { RouterOutputs } from "@synoro/api";

export type SidebarPractice = RouterOutputs["practice"]["mine"][number];

export const ROLE_LABELS = {
  owner: "Специалист",
  admin: "Администратор",
  client: "Клиент",
} as const;

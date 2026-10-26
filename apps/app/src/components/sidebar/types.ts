import type { RouterOutputs } from "@acme/api";

export type SidebarPractice = RouterOutputs["practice"]["mine"][number];

export const ROLE_LABELS = {
  owner: "Специалист",
  admin: "Администратор",
  client: "Клиент",
} as const;

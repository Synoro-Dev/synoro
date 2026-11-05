"use server";

import { ORPCError } from "@orpc/server";
import { redirect } from "next/navigation";

import { requireAdmin } from "~/auth/server";
import { api } from "~/orpc/server";

/**
 * Delete the user and go back to the list. Returns the reason when the
 * procedure refuses (own account, an admin, wrong confirmation).
 */
export async function deleteUser(
  id: string,
  confirm: string,
): Promise<{ error: string }> {
  await requireAdmin();
  try {
    await api.users.remove({ id, confirm });
  } catch (error) {
    if (error instanceof ORPCError) return { error: error.message };
    throw error;
  }
  redirect("/users");
}

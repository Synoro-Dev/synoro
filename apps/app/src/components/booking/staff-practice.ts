import "server-only";

import { paths } from "@acme/config";
import { ORPCError } from "@orpc/server";
import { notFound, redirect } from "next/navigation";

import { api } from "~/orpc/server";

/**
 * The practice behind a staff console page. Strangers and bad ids get a 404,
 * clients are sent to the booking page — the console is for staff only.
 */
export async function loadStaffPractice(practiceId: string) {
  const practice = await api.practice
    .get({ practiceId })
    .catch((error: unknown) => {
      // Not a member (FORBIDDEN) or not a uuid (BAD_REQUEST): no such page.
      if (
        error instanceof ORPCError &&
        (error.code === "FORBIDDEN" || error.code === "BAD_REQUEST")
      ) {
        notFound();
      }
      throw error;
    });

  if (practice.membership.role === "client") {
    redirect(paths.booking.public(practice.slug));
  }
  return practice;
}

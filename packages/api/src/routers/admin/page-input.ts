import { z } from "zod";

/** Paging and a free-text filter shared by the admin lists. */
export const pageInput = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

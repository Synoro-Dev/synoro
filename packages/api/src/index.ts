import type { InferRouterInputs, InferRouterOutputs } from "@orpc/server";

import type { AppRouter } from "./routers";

/**
 * Inference helpers for input types.
 *
 * @example
 *   type CreatePostInput = RouterInputs['post']['create']
 *   //   ^? { title: string; content: string }
 */
type RouterInputs = InferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types.
 *
 * @example
 *   type PostListOutput = RouterOutputs['post']['list']
 *   //   ^? { id: string; title: string; ... }[]
 */
type RouterOutputs = InferRouterOutputs<AppRouter>;

export { errorStatusMap } from "./errors";
export { finishGoogleConnect } from "./lib/google-calendar";
export { handlePaymentWebhook } from "./lib/payments";
export { findOwnerMembership } from "./lib/practice-access";
export { createORPCContext } from "./orpc";
export { type AppRouter, appRouter } from "./routers";
export type { RouterInputs, RouterOutputs };

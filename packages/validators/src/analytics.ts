import { z } from "zod";

/** Lengths of the window «Аналитика» looks at, in days, ending now. */
export const ANALYTICS_PERIODS = [30, 90, 365] as const;

export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const analyticsPeriodSchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(365),
]);

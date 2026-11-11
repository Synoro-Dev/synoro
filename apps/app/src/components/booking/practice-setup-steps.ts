import { paths } from "@synoro/config";

/** The first setup's steps, in order; each can be skipped. */
export const SETUP_STEPS = [
  "import",
  "hours",
  "prices",
  "rules",
  "link",
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export function setupStepHref(practiceId: string, step: SetupStep) {
  return `${paths.booking.setup(practiceId)}?step=${step}`;
}

/** The step in the address; the first one when it names no step. */
export function setupStepFrom(param: string | null): SetupStep {
  return SETUP_STEPS.find((step) => step === param) ?? "import";
}

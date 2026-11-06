const ROOTS = {
  DASHBOARD: "/",
  AUTH: "/auth",
  SETTINGS: "/settings",
  PRACTICES: "/practices",
} as const;

export const paths = {
  api: {
    /**
     * Where the auth handler lives. Not the library's default `/api/auth`, so
     * the URL doesn't name it. Keep `proxy.ts`'s matcher (a literal) and the
     * probes in `infra/synoro/*.yaml` in step.
     */
    auth: "/api/account",
  },
  dashboard: {
    root: ROOTS.DASHBOARD,
  },
  auth: {
    root: ROOTS.AUTH,
    login: `${ROOTS.AUTH}/login`,
    signup: `${ROOTS.AUTH}/signup`,
    /** Demo stand only: signs the visitor in as the demo account. */
    demo: `${ROOTS.AUTH}/demo`,
    forgotPassword: `${ROOTS.AUTH}/forgot-password`,
    resetPassword: `${ROOTS.AUTH}/reset-password`,
  },
  settings: {
    root: ROOTS.SETTINGS,
    profile: `${ROOTS.SETTINGS}/profile`,
    security: `${ROOTS.SETTINGS}/security`,
    /** Notices in Telegram or MAX instead of mail («Про»). */
    notifications: `${ROOTS.SETTINGS}/notifications`,
    /** The «Про» plan: trial, paid period, payment. */
    billing: `${ROOTS.SETTINGS}/billing`,
  },
  booking: {
    /** Practices the user runs or is a client of; create a new one. */
    practices: ROOTS.PRACTICES,
    practice: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}` as const,
    calendar: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/calendar` as const,
    /** Free time to book a client who calls: windows and starts per day. */
    windows: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/windows` as const,
    clients: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/clients` as const,
    schedule: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/schedule` as const,
    /** How the practice is doing («Про»): meetings, no-shows, revenue, clients. */
    analytics: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/analytics` as const,
    /** Own messages to clients («Про»): after a meeting, package, quiet clients. */
    messages: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/messages` as const,
    /** Editing the public page: photo, link, video room. */
    page: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/booking-page` as const,
    /** The practice's own domain. Off sale: not in `practiceSections`. */
    domain: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/domain` as const,
    /** Incoming payments. Connecting a provider: `onlinePayment`. */
    payments: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/payments` as const,
    /** First setup, right after creating a practice: `?step=` picks the step. */
    setup: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/setup` as const,
    /** The practice's settings: every section the viewer's role may open. */
    settings: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/settings` as const,
    /** What clients may cancel and when, read-only. */
    rules: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/rules` as const,
    /** What clients book: names, lengths, prices in credits. */
    services: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/services` as const,
    /** The questionnaire clients fill in when booking («Про»). */
    questions: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/questions` as const,
    /** Owner and administrators. */
    team: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/team` as const,
    /** The provider clients pay through, and the prices («Про»). */
    onlinePayment: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/online-payment` as const,
    /** The owner's plan, beside the practice's other settings. */
    plan: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/plan` as const,
    /** The client's own consultations. */
    mine: "/bookings",
    /**
     * Public booking page of a practice: `/anna`, straight under the root.
     * A slug must never equal a top-level route (`RESERVED_SLUGS`). The old
     * address `/p/anna` redirects here (proxy.ts).
     */
    public: (slug: string) => `/${slug}` as const,
    /**
     * The specialist's photo on that page. Ends in `.jpg` so a practice's own
     * host serves it as an asset (proxy.ts lets file-like paths through).
     */
    avatar: (slug: string) => `/${slug}/avatar.jpg` as const,
    /** Upload (POST) and remove (DELETE) the photo; staff cabinet only. */
    avatarUpload: (practiceId: string) =>
      `/api/practices/${practiceId}/avatar` as const,
    /** A visitor's booking, opened by the secret in their link (no sign-in). */
    guest: (token: string) => `/b/${token}` as const,
    /** The same page on a practice's own host; proxy.ts rewrites `/` here. */
    site: (host: string) => `/site/${host}` as const,
  },
} as const;

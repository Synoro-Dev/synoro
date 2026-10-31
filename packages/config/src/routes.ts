const ROOTS = {
  DASHBOARD: "/",
  AUTH: "/auth",
  SETTINGS: "/settings",
  PRACTICES: "/practices",
} as const;

export const paths = {
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
    /** Platform subdomain and the practice's own domain. */
    domain: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/domain` as const,
    /** Online payments: provider, packages, incoming payments. */
    payments: (practiceId: string) =>
      `${ROOTS.PRACTICES}/${practiceId}/payments` as const,
    /** The client's own consultations. */
    mine: "/bookings",
    /** Public booking page of a practice. */
    public: (slug: string) => `/p/${slug}` as const,
    /**
     * The specialist's photo on that page. Ends in `.jpg` so a practice's own
     * host serves it as an asset (proxy.ts lets file-like paths through).
     */
    avatar: (slug: string) => `/p/${slug}/avatar.jpg` as const,
    /** Upload (POST) and remove (DELETE) the photo; staff cabinet only. */
    avatarUpload: (practiceId: string) =>
      `/api/practices/${practiceId}/avatar` as const,
    /** A visitor's booking, opened by the secret in their link (no sign-in). */
    guest: (token: string) => `/b/${token}` as const,
    /** The same page on a practice's own host; proxy.ts rewrites `/` here. */
    site: (host: string) => `/site/${host}` as const,
  },
} as const;

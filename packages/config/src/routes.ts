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
    forgotPassword: `${ROOTS.AUTH}/forgot-password`,
    resetPassword: `${ROOTS.AUTH}/reset-password`,
  },
  settings: {
    root: ROOTS.SETTINGS,
    profile: `${ROOTS.SETTINGS}/profile`,
    security: `${ROOTS.SETTINGS}/security`,
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
    /** A visitor's booking, opened by the secret in their link (no sign-in). */
    guest: (token: string) => `/b/${token}` as const,
    /** The same page on a practice's own host; proxy.ts rewrites `/` here. */
    site: (host: string) => `/site/${host}` as const,
  },
} as const;

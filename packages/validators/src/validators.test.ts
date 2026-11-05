import { describe, expect, test } from "bun:test";
import { accountFormSchema } from "./account";
import {
  availabilityFormSchema,
  creditGrantFormSchema,
  formatMinutes,
  freeBookingFormSchema,
  guestBookingFormSchema,
  introMinutesSchema,
  legacyPracticePath,
  normalizeHostname,
  practiceContactSchema,
  practiceFormSchema,
  practiceSlugOfPath,
} from "./booking";
import {
  type BookingQuestion,
  bookingQuestionsSchema,
  checkBookingAnswers,
} from "./booking-questions";
import { loginFormSchema } from "./login";
import { otpFormSchema } from "./otp";
import { changePasswordFormSchema } from "./password";
import { paymentAccountFormSchema, paymentPackagesFormSchema } from "./payment";
import { formatPhone, normalizePhone } from "./phone";
import {
  formatCredits,
  PROFESSION_TERMS,
  PROFESSIONS,
  pluralize,
  professionTerms,
} from "./profession";
import { profileFormSchema } from "./profile";
import { canonicalTimeZone, clientTimeZoneInput } from "./timezone";
import { normalizeVideoUrl, videoServiceName, videoUrlSchema } from "./video";
import {
  renderWorkflowText,
  unknownWorkflowVariables,
  WORKFLOW_PRESETS,
  WORKFLOW_TRIGGERS,
  workflowFormSchema,
} from "./workflow";

describe("normalizeVideoUrl", () => {
  test("keeps an https link", () => {
    expect(normalizeVideoUrl("https://acme.ktalk.ru/room")).toBe(
      "https://acme.ktalk.ru/room",
    );
  });

  test("adds the missing scheme", () => {
    expect(normalizeVideoUrl(" acme.ktalk.ru/room ")).toBe(
      "https://acme.ktalk.ru/room",
    );
  });

  test("refuses anything but https", () => {
    expect(normalizeVideoUrl("http://acme.ktalk.ru/room")).toBeNull();
    expect(normalizeVideoUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeVideoUrl("tel:+79001234567")).toBeNull();
  });

  test("refuses logins, spaces and hosts without a dot", () => {
    expect(normalizeVideoUrl("https://user:pass@acme.ktalk.ru/")).toBeNull();
    expect(normalizeVideoUrl("https://acme.ktalk.ru/a b")).toBeNull();
    expect(normalizeVideoUrl("https://localhost/room")).toBeNull();
    expect(normalizeVideoUrl("")).toBeNull();
  });
});

describe("videoServiceName", () => {
  test("names the known services", () => {
    expect(videoServiceName("https://acme.ktalk.ru/room")).toBe("Толк");
    expect(videoServiceName("https://telemost.yandex.ru/j/1")).toBe("Телемост");
    expect(videoServiceName("https://meet.google.com/abc-defg")).toBe(
      "Google Meet",
    );
    expect(videoServiceName("https://us02web.zoom.us/j/1")).toBe("Zoom");
  });

  test("does not trust a lookalike host", () => {
    expect(videoServiceName("https://ktalk.ru.evil.com/room")).toBe(
      "Видеовстреча",
    );
    expect(videoServiceName("https://evilktalk.ru/room")).toBe("Видеовстреча");
  });
});

describe("practiceContactSchema", () => {
  test("keeps the text, trimmed", () => {
    expect(practiceContactSchema.parse("  @anna, +7 900 123-45-67 ")).toBe(
      "@anna, +7 900 123-45-67",
    );
  });

  test("empty input means no contact", () => {
    expect(practiceContactSchema.parse("   ")).toBeNull();
  });

  test("refuses a very long one", () => {
    expect(practiceContactSchema.safeParse("x".repeat(201)).success).toBe(
      false,
    );
  });
});

describe("videoUrlSchema", () => {
  test("empty input means no link", () => {
    expect(videoUrlSchema.parse("  ")).toBeNull();
  });

  test("returns the clean URL", () => {
    expect(videoUrlSchema.parse("acme.ktalk.ru/room")).toBe(
      "https://acme.ktalk.ru/room",
    );
  });

  test("rejects a bad link with a message", () => {
    const result = videoUrlSchema.safeParse("not a link");
    expect(result.success).toBe(false);
  });
});

describe("profileFormSchema", () => {
  test("accepts a valid profile", () => {
    const result = profileFormSchema.safeParse({
      username: "jane",
      email: "jane@example.com",
      phone: "8 (900) 123-45-67",
      bio: "hello",
    });
    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe("+79001234567");
  });

  test("rejects a too-short username", () => {
    const result = profileFormSchema.safeParse({
      username: "j",
      email: "jane@example.com",
      phone: "+79001234567",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an invalid email", () => {
    const result = profileFormSchema.safeParse({
      username: "jane",
      email: "not-an-email",
      phone: "+79001234567",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a bio longer than 160 chars", () => {
    const result = profileFormSchema.safeParse({
      username: "jane",
      email: "jane@example.com",
      phone: "+79001234567",
      bio: "x".repeat(161),
    });
    expect(result.success).toBe(false);
  });
});

describe("profileFormSchema phone", () => {
  test("is required", () => {
    const result = profileFormSchema.safeParse({
      username: "jane",
      email: "jane@example.com",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["phone"]);
  });
});

describe("accountFormSchema", () => {
  test("accepts a valid account", () => {
    const result = accountFormSchema.safeParse({ name: "Jane" });
    expect(result.success).toBe(true);
  });

  test("rejects a too-short name", () => {
    const result = accountFormSchema.safeParse({ name: "J" });
    expect(result.success).toBe(false);
  });
});

describe("loginFormSchema", () => {
  test("accepts a valid email", () => {
    expect(loginFormSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });

  test("rejects an empty email", () => {
    expect(loginFormSchema.safeParse({ email: "" }).success).toBe(false);
  });
});

describe("otpFormSchema", () => {
  test("accepts a 6-digit code", () => {
    expect(otpFormSchema.safeParse({ otp: "123456" }).success).toBe(true);
  });

  test("rejects non-digit codes", () => {
    expect(otpFormSchema.safeParse({ otp: "12345a" }).success).toBe(false);
  });

  test("rejects codes that are not exactly 6 digits", () => {
    expect(otpFormSchema.safeParse({ otp: "12345" }).success).toBe(false);
  });
});

describe("changePasswordFormSchema", () => {
  const valid = {
    currentPassword: "old-password",
    newPassword: "new-password-1",
    confirmPassword: "new-password-1",
    revokeOtherSessions: true,
  };

  test("accepts a valid password change", () => {
    expect(changePasswordFormSchema.safeParse(valid).success).toBe(true);
  });

  test("requires the current password", () => {
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      currentPassword: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a new password shorter than 8 characters", () => {
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      newPassword: "short",
      confirmPassword: "short",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a new password longer than 128 characters", () => {
    const long = "x".repeat(129);
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      newPassword: long,
      confirmPassword: long,
    });
    expect(result.success).toBe(false);
  });

  test("rejects mismatched confirmation on the confirm field", () => {
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      confirmPassword: "different-password",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });

  test("rejects reusing the current password", () => {
    const result = changePasswordFormSchema.safeParse({
      ...valid,
      newPassword: valid.currentPassword,
      confirmPassword: valid.currentPassword,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["newPassword"]);
  });
});

describe("practiceFormSchema", () => {
  test("lowercases and accepts a valid slug", () => {
    const result = practiceFormSchema.parse({
      name: "Анна Иванова",
      slug: "Anna-Ivanova",
      profession: "tutor",
    });
    expect(result.slug).toBe("anna-ivanova");
  });

  test("requires a known profession", () => {
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "anna" }).success,
    ).toBe(false);
    expect(
      practiceFormSchema.safeParse({
        name: "Анна",
        slug: "anna",
        profession: "astrologer",
      }).success,
    ).toBe(false);
  });

  test("rejects a slug with a leading dash or Cyrillic", () => {
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "-anna" }).success,
    ).toBe(false);
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "анна" }).success,
    ).toBe(false);
  });
});

describe("availabilityFormSchema", () => {
  test("rejects more than 168 non-overlapping intervals", () => {
    const rules = Array.from({ length: 169 }, (_, i) => ({
      weekday: Math.floor(i / 48) + 1,
      startMinute: (i % 48) * 30,
      endMinute: (i % 48) * 30 + 30,
    }));
    const result = availabilityFormSchema.safeParse({ rules });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: "too_big", path: ["rules"] }),
    );
  });

  test("accepts non-overlapping half-hour intervals", () => {
    const result = availabilityFormSchema.safeParse({
      rules: [
        { weekday: 1, startMinute: 600, endMinute: 780 },
        { weekday: 1, startMinute: 900, endMinute: 1140 },
        { weekday: 2, startMinute: 600, endMinute: 1440 },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects intervals off the 30-minute grid", () => {
    const result = availabilityFormSchema.safeParse({
      rules: [{ weekday: 1, startMinute: 615, endMinute: 780 }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects an interval that ends before it starts", () => {
    const result = availabilityFormSchema.safeParse({
      rules: [{ weekday: 3, startMinute: 780, endMinute: 600 }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects overlapping intervals on the same day", () => {
    const result = availabilityFormSchema.safeParse({
      rules: [
        { weekday: 1, startMinute: 600, endMinute: 780 },
        { weekday: 1, startMinute: 720, endMinute: 900 },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("practiceFormSchema reserved slugs", () => {
  /** The paths of the errors for a form that is valid except for its slug. */
  const errorPaths = (slug: string) => {
    const result = practiceFormSchema.safeParse({
      name: "Анна",
      slug,
      profession: "tutor",
    });
    return result.success ? [] : result.error.issues.map((i) => i.path[0]);
  };

  test("accepts a free address, so the cases below fail for the slug", () => {
    expect(errorPaths("anna")).toEqual([]);
  });

  test("rejects slugs reserved for platform subdomains", () => {
    expect(errorPaths("www")).toEqual(["slug"]);
    expect(errorPaths("API")).toEqual(["slug"]);
  });

  test("rejects the top-level routes of the app and the landing", () => {
    for (const slug of [
      "practices",
      "settings",
      "bookings",
      "legal",
      "pricing",
    ]) {
      expect(errorPaths(slug)).toEqual(["slug"]);
    }
  });
});

describe("practiceSlugOfPath", () => {
  test("finds the practice of a booking page and of its photo", () => {
    expect(practiceSlugOfPath("/anna")).toBe("anna");
    expect(practiceSlugOfPath("/anna/")).toBe("anna");
    expect(practiceSlugOfPath("/anna-ivanova/avatar.jpg")).toBe("anna-ivanova");
    expect(practiceSlugOfPath("/Anna")).toBe("anna");
  });

  test("leaves the app's own routes and other paths alone", () => {
    for (const path of [
      "/",
      "/practices",
      "/practices/abc/calendar",
      "/settings",
      "/b/token",
      "/p/anna",
      "/anna/other",
      "/anna/avatar.jpg/x",
      "/an",
      "/-anna",
      "/Practices",
      "/favicon.ico",
    ]) {
      expect(practiceSlugOfPath(path)).toBeUndefined();
    }
  });
});

describe("legacyPracticePath", () => {
  test("turns /p/<slug>… into /<slug>…", () => {
    expect(legacyPracticePath("/p/anna")).toBe("/anna");
    expect(legacyPracticePath("/p/anna/avatar.jpg")).toBe("/anna/avatar.jpg");
  });

  test("ignores everything else", () => {
    expect(legacyPracticePath("/anna")).toBeUndefined();
    expect(legacyPracticePath("/p/")).toBeUndefined();
    expect(legacyPracticePath("/p/settings")).toBeUndefined();
    expect(legacyPracticePath("/pricing")).toBeUndefined();
  });
});

describe("normalizeHostname", () => {
  test("strips scheme, path, port and trailing dot", () => {
    expect(normalizeHostname(" https://Anna-Ivanova.ru/zapis?x=1 ")).toBe(
      "anna-ivanova.ru",
    );
    expect(normalizeHostname("zapis.anna.ru:443")).toBe("zapis.anna.ru");
    expect(normalizeHostname("anna.ru.")).toBe("anna.ru");
  });

  test("converts Cyrillic domains to punycode", () => {
    expect(normalizeHostname("Анна.рф")).toBe("xn--80aa2ba.xn--p1ai");
  });

  test("rejects non-hosts", () => {
    for (const value of [
      "",
      "anna",
      "localhost",
      "1.2.3.4",
      "a b.ru",
      "-a.ru",
    ]) {
      expect(normalizeHostname(value)).toBeNull();
    }
  });
});

describe("creditGrantFormSchema", () => {
  test("accepts positive and negative amounts", () => {
    expect(creditGrantFormSchema.safeParse({ delta: 5 }).success).toBe(true);
    expect(creditGrantFormSchema.safeParse({ delta: -2 }).success).toBe(true);
  });

  test("rejects zero and fractions", () => {
    expect(creditGrantFormSchema.safeParse({ delta: 0 }).success).toBe(false);
    expect(creditGrantFormSchema.safeParse({ delta: 1.5 }).success).toBe(false);
  });
});

describe("freeBookingFormSchema", () => {
  test("requires a guest name and a phone", () => {
    expect(
      freeBookingFormSchema.safeParse({
        guestName: "  ",
        guestPhone: "+7 900 000-00-00",
      }).success,
    ).toBe(false);
    expect(freeBookingFormSchema.safeParse({ guestName: "Иван" }).success).toBe(
      false,
    );
    const result = freeBookingFormSchema.safeParse({
      guestName: "Иван",
      guestPhone: "8 900 000 00 00",
      guestContact: "@ivan",
    });
    expect(result.success).toBe(true);
    expect(result.data?.guestPhone).toBe("+79000000000");
  });
});

describe("guestBookingFormSchema", () => {
  const base = {
    name: "Иван Петров",
    phone: "+7 (900) 123-45-67",
    email: "ivan@example.com",
  };

  test("accepts a visitor and normalises the phone", () => {
    const result = guestBookingFormSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe("+79001234567");
  });

  test("requires phone and email", () => {
    expect(
      guestBookingFormSchema.safeParse({ ...base, phone: "" }).success,
    ).toBe(false);
    expect(
      guestBookingFormSchema.safeParse({ ...base, email: "ivan" }).success,
    ).toBe(false);
  });
});

describe("normalizePhone", () => {
  test("turns Russian formats into E.164", () => {
    for (const input of [
      "+7 900 123-45-67",
      "8 (900) 123 45 67",
      "7-900-123-45-67",
      "9001234567",
    ]) {
      expect(normalizePhone(input)).toBe("+79001234567");
    }
  });

  test("keeps international numbers", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  test("rejects things that are not phones", () => {
    for (const input of ["", "abc", "12345", "+7 900 123", "8 900 12", "+1"]) {
      expect(normalizePhone(input)).toBeNull();
    }
  });

  test("formatPhone groups +7 numbers", () => {
    expect(formatPhone("+79001234567")).toBe("+7 900 123-45-67");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
  });
});

describe("paymentAccountFormSchema", () => {
  const base = {
    provider: "tbank" as const,
    merchantId: "1700000000000DEMO",
    secret: "password",
    receipts: false,
    taxSystem: null,
  };

  test("accepts a Т-Банк terminal without receipts", () => {
    expect(paymentAccountFormSchema.safeParse(base).success).toBe(true);
  });

  test("requires the taxation system for Т-Банк receipts", () => {
    const result = paymentAccountFormSchema.safeParse({
      ...base,
      receipts: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["taxSystem"]);
  });

  test("lets ЮKassa receipts go without one (Чеки от ЮKassa)", () => {
    const result = paymentAccountFormSchema.safeParse({
      ...base,
      provider: "yookassa",
      merchantId: "123456",
      receipts: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("paymentPackagesFormSchema", () => {
  test("rejects two packages of the same size", () => {
    const result = paymentPackagesFormSchema.safeParse({
      packages: [
        { credits: 5, price: 1_400_000 },
        { credits: 5, price: 1_300_000 },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects a price under one ruble", () => {
    const result = paymentPackagesFormSchema.safeParse({
      packages: [{ credits: 1, price: 50 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("profession terms", () => {
  test("pluralizes after a number", () => {
    const tutor = professionTerms("tutor");
    expect(formatCredits(1, tutor)).toBe("1 занятие");
    expect(formatCredits(3, tutor)).toBe("3 занятия");
    expect(formatCredits(5, tutor)).toBe("5 занятий");
    expect(formatCredits(11, tutor)).toBe("11 занятий");
    expect(formatCredits(12, tutor)).toBe("12 занятий");
    expect(formatCredits(21, tutor)).toBe("21 занятие");
    expect(formatCredits(22, tutor)).toBe("22 занятия");
    expect(formatCredits(0, tutor)).toBe("0 занятий");
    expect(pluralize(-1, tutor.credit)).toBe("занятие");
  });

  test("keeps the psychologist wording unchanged", () => {
    expect(formatCredits(2, professionTerms("psychologist"))).toBe(
      "2 консультации",
    );
  });

  test("covers every profession", () => {
    expect(Object.keys(PROFESSION_TERMS).sort()).toEqual(
      [...PROFESSIONS].sort(),
    );
  });
});

describe("workflow texts", () => {
  const values = {
    имя: "Иван",
    практика: "Анна Иванова",
    дата: "3 ноября",
    время: "19:00",
    баланс: "1",
    ссылка: "https://synoro.ru/anna",
    кабинет: "https://synoro.ru/bookings",
  };

  test("fills in the placeholders and leaves unknown ones", () => {
    expect(renderWorkflowText("{имя}, осталось {баланс} ({что})", values)).toBe(
      "Иван, осталось 1 ({что})",
    );
  });

  test("does not read inherited properties as variables", () => {
    expect(renderWorkflowText("{constructor}", values)).toBe("{constructor}");
    expect(unknownWorkflowVariables("{toString}")).toEqual(["toString"]);
  });

  test("lists each unknown placeholder once", () => {
    expect(unknownWorkflowVariables("{имя} {фамилия} {фамилия} {}")).toEqual([
      "фамилия",
      "",
    ]);
  });

  test("every preset passes its own form schema", () => {
    for (const trigger of WORKFLOW_TRIGGERS) {
      const preset = WORKFLOW_PRESETS[trigger];
      const result = workflowFormSchema.safeParse({
        trigger,
        amount: preset.defaultAmount,
        subject: preset.subject,
        text: preset.text,
        active: true,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("workflowFormSchema", () => {
  const valid = {
    trigger: "after_end" as const,
    amount: 2,
    subject: "Спасибо",
    text: "Здравствуйте, {имя}!",
    active: true,
  };

  test("keeps amount inside the range of the trigger", () => {
    expect(workflowFormSchema.safeParse({ ...valid, amount: 0 }).success).toBe(
      false,
    );
    expect(workflowFormSchema.safeParse({ ...valid, amount: 73 }).success).toBe(
      false,
    );
    expect(
      workflowFormSchema.safeParse({
        ...valid,
        trigger: "low_balance",
        amount: 0,
      }).success,
    ).toBe(true);
    expect(
      workflowFormSchema.safeParse({
        ...valid,
        trigger: "inactive",
        amount: 3,
      }).success,
    ).toBe(false);
  });

  test("explains a missing or fractional amount in Russian", () => {
    const empty = workflowFormSchema.safeParse({
      ...valid,
      amount: Number.NaN,
    });
    expect(empty.error?.issues[0]?.message).toBe("Укажите число");
    const fraction = workflowFormSchema.safeParse({ ...valid, amount: 1.5 });
    expect(fraction.error?.issues[0]?.message).toBe("Нужно целое число");
  });

  test("refuses unknown placeholders and a multi-line subject", () => {
    const text = workflowFormSchema.safeParse({
      ...valid,
      text: "Привет {фио}",
    });
    expect(text.error?.issues[0]?.message).toContain("{фио}");
    expect(
      workflowFormSchema.safeParse({ ...valid, subject: "a\nb" }).success,
    ).toBe(false);
  });
});

describe("booking questionnaire", () => {
  const question = (over: Partial<BookingQuestion>): BookingQuestion => ({
    id: crypto.randomUUID(),
    label: "Вопрос",
    kind: "text",
    options: [],
    required: false,
    ...over,
  });

  test("a choice needs two distinct options, other kinds none", () => {
    const ok = question({ kind: "choice", options: ["Да", "Нет"] });
    expect(bookingQuestionsSchema.safeParse([ok]).success).toBe(true);
    for (const bad of [
      question({ kind: "choice", options: ["Да"] }),
      question({ kind: "choice", options: ["Да", "Да"] }),
      question({ kind: "text", options: ["Да", "Нет"] }),
      question({ label: "  " }),
    ]) {
      expect(bookingQuestionsSchema.safeParse([bad]).success).toBe(false);
    }
  });

  test("rejects repeated ids and more than ten questions", () => {
    const one = question({});
    expect(bookingQuestionsSchema.safeParse([one, one]).success).toBe(false);
    const many = Array.from({ length: 11 }, () => question({}));
    expect(bookingQuestionsSchema.safeParse(many).success).toBe(false);
  });

  test("checks answers and keeps them with the wording, in order", () => {
    const a = question({ label: "Запрос", required: true });
    const b = question({
      label: "Формат",
      kind: "choice",
      options: ["Онлайн", "Очно"],
    });
    const c = question({ label: "Откуда узнали" });

    expect(checkBookingAnswers([a, b, c], {})).toEqual({
      answers: [],
      errors: { [a.id]: "Ответьте на вопрос" },
    });
    expect(
      checkBookingAnswers([a, b, c], {
        [b.id]: "Очно",
        [a.id]: " Тревога ",
        [c.id]: "",
        unknown: "x",
      }),
    ).toEqual({
      answers: [
        { question: "Запрос", answer: "Тревога" },
        { question: "Формат", answer: "Очно" },
      ],
      errors: {},
    });
    expect(
      checkBookingAnswers([a, b], { [a.id]: "x".repeat(201), [b.id]: "Да" })
        .errors,
    ).toEqual({
      [a.id]: "Не больше 200 символов",
      [b.id]: "Выберите вариант из списка",
    });
  });
});

describe("intro length", () => {
  test("accepts only the offered lengths", () => {
    expect(introMinutesSchema.safeParse(45).success).toBe(true);
    expect(introMinutesSchema.safeParse(50).success).toBe(false);
  });

  test("reads as minutes or hours", () => {
    expect(formatMinutes(30)).toBe("30 минут");
    expect(formatMinutes(45)).toBe("45 минут");
    expect(formatMinutes(60)).toBe("1 час");
    expect(formatMinutes(90)).toBe("1,5 часа");
    expect(formatMinutes(120)).toBe("2 часа");
    expect(formatMinutes(21)).toBe("21 минута");
    expect(formatMinutes(90, true)).toBe("1,5 ч");
    expect(formatMinutes(45, true)).toBe("45 мин");
  });
});

describe("clientTimeZoneInput", () => {
  test("keeps a known zone, in its canonical spelling", () => {
    expect(clientTimeZoneInput.parse("Asia/Novosibirsk")).toBe(
      "Asia/Novosibirsk",
    );
    expect(clientTimeZoneInput.parse("europe/moscow")).toBe("Europe/Moscow");
  });

  test("drops an unknown zone instead of failing", () => {
    expect(clientTimeZoneInput.parse("Mars/Olympus")).toBeUndefined();
    expect(clientTimeZoneInput.parse("")).toBeUndefined();
    expect(clientTimeZoneInput.parse(undefined)).toBeUndefined();
  });

  test("refuses a name too long to be a zone", () => {
    expect(clientTimeZoneInput.safeParse("x".repeat(65)).success).toBe(false);
  });

  test("canonicalTimeZone is undefined for garbage", () => {
    expect(canonicalTimeZone("not a zone")).toBeUndefined();
    expect(canonicalTimeZone("UTC")).toBe("UTC");
  });
});

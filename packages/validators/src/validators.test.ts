import { describe, expect, test } from "bun:test";
import { accountFormSchema } from "./account";
import {
  availabilityFormSchema,
  creditGrantFormSchema,
  freeBookingFormSchema,
  guestBookingFormSchema,
  normalizeHostname,
  practiceFormSchema,
} from "./booking";
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
  test("rejects slugs reserved for platform subdomains", () => {
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "www" }).success,
    ).toBe(false);
    expect(
      practiceFormSchema.safeParse({ name: "Анна", slug: "API" }).success,
    ).toBe(false);
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

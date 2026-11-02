import { describe, expect, test } from "bun:test";

import { matchClients, phoneDigits } from "./client-search";

const clients = [
  { name: "Иван Петров", phone: "+79001234567" },
  { name: "Мария Сидорова", phone: "+79161112233" },
  { name: "Без телефона", phone: null },
];
const names = (query: string) =>
  matchClients(clients, query).map((c) => c.name);

describe("matchClients", () => {
  test("finds by part of the name, any case", () => {
    expect(names("пЕтр")).toEqual(["Иван Петров"]);
    expect(names("")).toHaveLength(3);
  });

  test("finds by digits anywhere in the phone", () => {
    expect(names("123-45")).toEqual(["Иван Петров"]);
    expect(names("+7 916")).toEqual(["Мария Сидорова"]);
    // Too few digits to mean a phone.
    expect(names("12")).toEqual([]);
  });

  test("reads a number begun with 8 as +7 while it is typed", () => {
    expect(names("8 900")).toEqual(["Иван Петров"]);
    expect(names("8 (916) 11")).toEqual(["Мария Сидорова"]);
    expect(names("8 900 123-45-67")).toEqual(["Иван Петров"]);
  });
});

describe("phoneDigits", () => {
  test("turns a full 8-number into the +7 one", () => {
    expect(phoneDigits("8 (900) 123-45-67")).toBe("79001234567");
    expect(phoneDigits("+7 900 123-45-67")).toBe("79001234567");
    expect(phoneDigits("8 900")).toBe("8900");
  });
});

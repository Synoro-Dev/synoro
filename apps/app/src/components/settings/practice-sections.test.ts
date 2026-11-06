import { describe, expect, test } from "bun:test";
import { paths } from "@synoro/config";

import { practiceSections } from "./practice-sections";

const ID = "00000000-0000-4000-8000-000000000000";
const titles = (isOwner: boolean) =>
  practiceSections(ID, isOwner).flatMap((group) =>
    group.sections.map((section) => section.title),
  );

describe("practiceSections", () => {
  test("the owner sees every section", () => {
    expect(titles(true)).toEqual([
      "Страница записи",
      "Рабочие часы",
      "Правила",
      "Анкета",
      "Сообщения клиентам",
      "Онлайн-оплата",
      "Команда",
      "Тариф",
    ]);
  });

  test("an administrator sees only what they may do", () => {
    expect(titles(false)).toEqual([
      "Страница записи",
      "Рабочие часы",
      "Правила",
      "Команда",
    ]);
  });

  test("a group with nothing allowed is dropped", () => {
    expect(practiceSections(ID, false).map((group) => group.title)).toEqual([
      "Запись",
      "Практика",
    ]);
  });

  test("the sections keep their old addresses", () => {
    const hrefs = practiceSections(ID, true).flatMap((group) =>
      group.sections.map((section) => section.href),
    );
    for (const href of [
      paths.booking.page(ID),
      paths.booking.schedule(ID),
      paths.booking.messages(ID),
    ]) {
      expect(hrefs).toContain(href);
    }
    expect(paths.booking.schedule(ID)).toBe(`/practices/${ID}/schedule`);
    expect(paths.booking.page(ID)).toBe(`/practices/${ID}/booking-page`);
  });
});

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  spyOn,
} from "bun:test";
import { call, isDefinedError } from "@orpc/server";
import type { Session } from "@synoro/auth";
import { eq, MessengerChat, PracticeMember, Subscription } from "@synoro/db";
import type { TemplateEmail } from "@synoro/emails";
import { deliverMessenger, dispatchNotice } from "@synoro/jobs/messenger";
import type { Messenger } from "@synoro/validators";

import { createSession, setupTestApi } from "../../../test/helpers";
import { handleMaxWebhook, handleTelegramWebhook } from "../../lib/messenger";
import { availabilityRouter } from "../availability";
import { bookingRouter } from "../booking";
import { practiceRouter } from "../practice";
import { messengerRouter } from ".";

let api: Awaited<ReturnType<typeof setupTestApi>>;
let fetchMock: Mock<typeof fetch>;

/** What the bots were asked to send: platform, recipient, text. */
let sent: {
  messenger: Messenger;
  to: string;
  text: string;
  buttons: string[];
}[] = [];

/** Mondays, 10:00–13:00 MSK. */
const monday = (week: number) =>
  new Date(Date.parse("2030-01-07T07:00:00Z") + week * 7 * 86_400_000);

/** Bot API answers: `status` for every send, 200 otherwise. */
function bots(status = 200) {
  fetchMock.mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.host === "telegram.test") {
      sent.push({
        messenger: "telegram",
        to: String(body.chat_id),
        text: body.text,
        buttons: (body.reply_markup?.inline_keyboard ?? [])
          .flat()
          .map((b: { text: string }) => b.text),
      });
      return status === 200
        ? Response.json({ ok: true, result: {} })
        : Response.json(
            {
              ok: false,
              description: "Forbidden: bot was blocked by the user",
            },
            { status },
          );
    }
    if (url.host === "max.test") {
      sent.push({
        messenger: "max",
        to: url.searchParams.get("user_id") ?? "",
        text: body.text,
        buttons: (body.attachments?.[0]?.payload.buttons ?? [])
          .flat()
          .map((b: { text: string }) => b.text),
      });
      return Response.json({}, { status });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch);
}

function telegram(update: unknown, secret = "test-telegram-secret-0123") {
  return handleTelegramWebhook(
    new Request("https://app.test/api/telegram", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify(update),
    }),
    api.db,
  );
}

function max(update: unknown, secret = "test-max-secret-0123456") {
  return handleMaxWebhook(
    new Request("https://app.test/api/max", {
      method: "POST",
      headers: { "X-Max-Bot-Api-Secret": secret },
      body: JSON.stringify(update),
    }),
    api.db,
  );
}

const startTelegram = (chatId: number, text: string) =>
  telegram({
    message: {
      text,
      chat: { id: chatId, type: "private" },
      from: { username: "ivan" },
    },
  });

const startMax = (userId: number, payload: string | null) =>
  max({
    update_type: "bot_started",
    chat_id: 1,
    user: { user_id: userId, name: "Иван", username: "ivan_max" },
    payload,
  });

/** The code in a start link from `messenger.link`. */
async function codeFor(session: Session, messenger: Messenger) {
  const { url } = await call(
    messengerRouter.link,
    { messenger },
    { context: api.context(session) },
  );
  return { url, code: new URL(url).searchParams.get("start") ?? "" };
}

const chatOf = (userId: string) =>
  api.db.query.MessengerChat.findFirst({
    where: eq(MessengerChat.userId, userId),
  });

/** An owner (on the trial, so «Про») with a bookable practice. */
async function newPractice(slug: string) {
  const owner = await createSession(api.db, { name: "Анна" });
  const practice = await call(
    practiceRouter.create,
    { name: "Анна Иванова", slug, profession: "psychologist" },
    { context: api.context(owner) },
  );
  await call(
    availabilityRouter.replace,
    {
      practiceId: practice.id,
      rules: [{ weekday: 1, startMinute: 600, endMinute: 780 }],
    },
    { context: api.context(owner) },
  );
  return { owner, practiceId: practice.id };
}

async function newClient(practiceId: string, credits = 0) {
  const session = await createSession(api.db, { name: "Иван" });
  const member = await call(
    practiceRouter.join,
    { practiceId },
    { context: api.context(session) },
  );
  await api.db
    .update(PracticeMember)
    .set({ credits })
    .where(eq(PracticeMember.id, member.id));
  return session;
}

async function endPro(owner: Session) {
  await api.db
    .update(Subscription)
    .set({ trialEndsAt: new Date("2020-01-01T00:00:00Z"), paidUntil: null })
    .where(eq(Subscription.userId, owner.user.id));
}

const notice = (practiceName: string): TemplateEmail => ({
  template: "booking-notice",
  to: ["ivan@client.test"],
  subject: "Напоминание",
  props: {
    notice: "reminder-hour",
    name: "Иван",
    practiceName,
    when: "понедельник, 7 января, 10:00",
    videoUrl: "https://meet.test/room",
    cabinetUrl: "https://synoro.test/bookings",
  },
});

beforeAll(async () => {
  api = await setupTestApi();
  fetchMock = spyOn(globalThis, "fetch");
});
afterEach(() => {
  fetchMock.mockReset();
  sent = [];
});
afterAll(async () => {
  fetchMock.mockRestore();
  if (api) await api.close();
});

describe("linking a messenger", () => {
  it("links Telegram by the start code once, and says so", async () => {
    bots();
    const { practiceId } = await newPractice("m-telegram");
    const client = await newClient(practiceId);

    const status = await call(messengerRouter.status, undefined, {
      context: api.context(client),
    });
    expect(status).toMatchObject({
      messengers: ["telegram", "max"],
      available: true,
      owner: false,
      chat: null,
    });

    const { url, code } = await codeFor(client, "telegram");
    expect(url).toStartWith("https://t.me/synoro_test_bot?start=");
    expect(code).toMatch(/^[0-9a-f]{32}$/);

    expect((await startTelegram(501, `/start ${code}`)).status).toBe(200);
    expect(await chatOf(client.user.id)).toMatchObject({
      messenger: "telegram",
      chatId: "501",
      username: "ivan",
      blockedAt: null,
    });
    expect(sent.at(-1)?.text).toStartWith("Готово!");

    // Spent: another chat can't take it over.
    await startTelegram(502, `/start ${code}`);
    expect((await chatOf(client.user.id))?.chatId).toBe("501");
    expect(sent.at(-1)?.text).toStartWith("Ссылка устарела");

    const linked = await call(messengerRouter.status, undefined, {
      context: api.context(client),
    });
    expect(linked.chat).toEqual({
      messenger: "telegram",
      username: "ivan",
      blocked: false,
    });
  });

  it("links MAX by the start payload and replaces Telegram", async () => {
    bots();
    const { practiceId } = await newPractice("m-max");
    const client = await newClient(practiceId);
    await startTelegram(
      601,
      `/start ${(await codeFor(client, "telegram")).code}`,
    );

    const { url, code } = await codeFor(client, "max");
    expect(url).toStartWith("https://max.ru/synoro_max_bot?start=");
    // A MAX code doesn't work in Telegram.
    await startTelegram(602, `/start ${code}`);
    expect((await chatOf(client.user.id))?.chatId).toBe("601");

    await startMax(9_000_000_001, code);
    expect(await chatOf(client.user.id)).toMatchObject({
      messenger: "max",
      chatId: "9000000001",
      username: "ivan_max",
    });
    expect(sent.at(-1)).toMatchObject({ messenger: "max", to: "9000000001" });
  });

  it("marks a blocked bot and clears the mark when it is allowed again", async () => {
    bots();
    const { practiceId } = await newPractice("m-blocked");
    const client = await newClient(practiceId);
    await startTelegram(
      701,
      `/start ${(await codeFor(client, "telegram")).code}`,
    );

    const member = (status: string) =>
      telegram({
        my_chat_member: {
          chat: { id: 701, type: "private" },
          new_chat_member: { status },
        },
      });
    await member("kicked");
    expect((await chatOf(client.user.id))?.blockedAt).not.toBeNull();
    await member("member");
    expect((await chatOf(client.user.id))?.blockedAt).toBeNull();

    const other = await newClient(practiceId);
    await startMax(801, (await codeFor(other, "max")).code);
    await max({ update_type: "bot_stopped", user: { user_id: 801 } });
    expect((await chatOf(other.user.id))?.blockedAt).not.toBeNull();
  });

  it("keeps only the newest link of a user working", async () => {
    bots();
    const { practiceId } = await newPractice("m-two-links");
    const client = await newClient(practiceId);
    const first = await codeFor(client, "telegram");
    const second = await codeFor(client, "max");

    await startTelegram(1401, `/start ${first.code}`);
    expect(await chatOf(client.user.id)).toBeUndefined();
    await startMax(1402, second.code);
    expect((await chatOf(client.user.id))?.chatId).toBe("1402");
  });

  it("revokes a link not opened yet on unlink", async () => {
    bots();
    const { practiceId } = await newPractice("m-revoke");
    const client = await newClient(practiceId);
    const { code } = await codeFor(client, "telegram");

    await call(messengerRouter.unlink, undefined, {
      context: api.context(client),
    });
    await startTelegram(1601, `/start ${code}`);
    expect(await chatOf(client.user.id)).toBeUndefined();
  });

  it("answers a start without a code with how to link", async () => {
    bots();
    await startTelegram(901, "/start");
    await startMax(902, null);
    expect(sent.map((s) => s.text)).toEqual([
      expect.stringContaining("нажмите «Подключить»"),
      expect.stringContaining("нажмите «Подключить»"),
    ]);
  });

  it("rejects calls without the platform's secret", async () => {
    expect((await telegram({}, "wrong-secret-0123456789")).status).toBe(401);
    expect((await max({}, "wrong-secret-0123456789")).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs a practice on «Про»; unlinking goes back to mail", async () => {
    bots();
    const { owner, practiceId } = await newPractice("m-free");
    const client = await newClient(practiceId);
    await startTelegram(
      1001,
      `/start ${(await codeFor(client, "telegram")).code}`,
    );

    await endPro(owner);
    const error = await codeFor(client, "telegram").catch((e) => e);
    expect(isDefinedError(error) && error.code).toBe("PLAN_REQUIRED");
    const status = await call(messengerRouter.status, undefined, {
      context: api.context(owner),
    });
    expect(status).toMatchObject({ available: false, owner: true });

    await call(messengerRouter.unlink, undefined, {
      context: api.context(client),
    });
    expect(await chatOf(client.user.id)).toBeUndefined();
  });
});

describe("notices in the messenger", () => {
  it("sends the client's and the staff's booking notices there", async () => {
    bots();
    const { owner, practiceId } = await newPractice("m-book");
    const client = await newClient(practiceId, 1);
    await startTelegram(
      1101,
      `/start ${(await codeFor(client, "telegram")).code}`,
    );
    await startMax(1102, (await codeFor(owner, "max")).code);
    sent = [];

    await call(
      bookingRouter.book,
      { practiceId, startsAt: monday(0) },
      { context: api.context(client) },
    );
    expect(sent).toEqual([
      {
        messenger: "telegram",
        to: "1101",
        text: expect.stringContaining("Вы записаны\nАнна Иванова —"),
        // APP_URL is http://localhost in tests: the link goes into the text.
        buttons: [],
      },
      {
        messenger: "max",
        to: "1102",
        text: expect.stringContaining("Новая запись: Иван —"),
        buttons: [],
      },
    ]);
    expect(sent[0]?.text).toContain("Мои записи: http://");
  });

  it("picks the messenger only on «Про», and falls back to mail", async () => {
    const { owner, practiceId } = await newPractice("m-deliver");
    const client = await newClient(practiceId);
    bots();
    await startTelegram(
      1201,
      `/start ${(await codeFor(client, "telegram")).code}`,
    );
    sent = [];
    const mails: TemplateEmail[] = [];
    const mail = async (email: TemplateEmail) => {
      mails.push(email);
    };
    const to = { userId: client.user.id, practiceId };

    await dispatchNotice(api.db, notice("Анна Иванова"), to, mail);
    expect(mails).toHaveLength(0);
    expect(sent[0]?.buttons).toEqual(["Войти на встречу", "Мои записи"]);

    // Not a messenger notice (no recipient): mail.
    await dispatchNotice(api.db, notice("Анна Иванова"), undefined, mail);
    expect(mails).toHaveLength(1);

    // The bot was blocked: the chat is marked and the mail goes instead.
    bots(403);
    await dispatchNotice(api.db, notice("Анна Иванова"), to, mail);
    expect(mails).toHaveLength(2);
    expect((await chatOf(client.user.id))?.blockedAt).not.toBeNull();
    sent = [];
    await dispatchNotice(api.db, notice("Анна Иванова"), to, mail);
    expect(sent).toHaveLength(0);
    expect(mails).toHaveLength(3);

    // Allowed again, but without «Про»: mail.
    await api.db
      .update(MessengerChat)
      .set({ blockedAt: null })
      .where(eq(MessengerChat.userId, client.user.id));
    await endPro(owner);
    bots();
    await dispatchNotice(api.db, notice("Анна Иванова"), to, mail);
    expect(sent).toHaveLength(0);
    expect(mails).toHaveLength(4);
  });

  it("mails a queued notice once the chat or «Про» is gone", async () => {
    const { owner, practiceId } = await newPractice("m-queued");
    const client = await newClient(practiceId);
    bots();
    await startTelegram(
      1501,
      `/start ${(await codeFor(client, "telegram")).code}`,
    );
    sent = [];
    const mails: TemplateEmail[] = [];
    const send = {
      userId: client.user.id,
      practiceId,
      messenger: "telegram" as const,
      chatId: "1501",
      message: { text: "Напоминание", buttons: [] },
      email: notice("Анна Иванова"),
    };
    const options = {
      lastAttempt: false,
      sendEmail: async (email: TemplateEmail) => {
        mails.push(email);
      },
    };

    // Switched to MAX before the task ran.
    await startMax(1502, (await codeFor(client, "max")).code);
    sent = [];
    await deliverMessenger(api.db, send, options);
    expect(sent).toHaveLength(0);
    expect(mails).toHaveLength(1);

    // «Про» ended before the task ran.
    await endPro(owner);
    await deliverMessenger(
      api.db,
      { ...send, messenger: "max", chatId: "1502" },
      options,
    );
    expect(sent).toHaveLength(0);
    expect(mails).toHaveLength(2);

    await call(messengerRouter.unlink, undefined, {
      context: api.context(client),
    });
    await deliverMessenger(
      api.db,
      { ...send, messenger: "max", chatId: "1502" },
      options,
    );
    expect(sent).toHaveLength(0);
    expect(mails).toHaveLength(3);
  });

  it("falls back to mail when the platform fails", async () => {
    const { practiceId } = await newPractice("m-down");
    const client = await newClient(practiceId);
    bots();
    await startMax(1301, (await codeFor(client, "max")).code);
    const mails: TemplateEmail[] = [];

    bots(503);
    await dispatchNotice(
      api.db,
      notice("Анна Иванова"),
      { userId: client.user.id, practiceId },
      async (email) => {
        mails.push(email);
      },
    );
    expect(mails).toHaveLength(1);
    // Not the user's doing: the chat stays linked.
    expect((await chatOf(client.user.id))?.blockedAt).toBeNull();
  });
});

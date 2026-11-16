import {
  OFFLINE_PAYMENT_METHOD_LABELS,
  type Profession,
  professionTerms,
} from "@synoro/validators";
import { strToU8, zipSync } from "fflate";

import type { AccountDump, PracticeDump } from "./collect";
import { type Cell, csvDate, phoneCell, rublesCell, toCsv } from "./csv";
import { buildCalendar, type CalendarEvent } from "./ics";
import { README_CLIENTS, README_FULL } from "./readme";

type Booking = PracticeDump["bookings"][number];

interface Person {
  name: string;
  phone: string | null;
  email: string | null;
}

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function kindLabel(kind: Booking["kind"], profession: Profession) {
  const terms = professionTerms(profession);
  if (kind === "free") return terms.free;
  if (kind === "blocked") return "Закрытое время";
  return capitalize(terms.credit[0]);
}

const CANCEL_REASONS: Record<NonNullable<Booking["cancel_reason"]>, string> = {
  client: "Отменил клиент",
  staff: "Отменил специалист или администратор",
  no_show: "Клиент не пришёл",
  late_cancel: "Клиент отменил поздно, без возврата",
  hold_expired: "Не оплачена вовремя",
  payment_cancelled: "Оплата отменена",
};

const PROVIDERS = { yookassa: "ЮKassa", tbank: "Т-Банк" } as const;

const PAYMENT_STATUSES = {
  pending: "Ожидает оплаты",
  succeeded: "Оплачено",
  canceled: "Отменён",
} as const;

/** Who a booking is for: a client's account contacts, or the guest's own. */
function bookingPerson(
  booking: Pick<
    Booking,
    "client_id" | "guest_name" | "guest_phone" | "guest_contact"
  >,
  people: Map<string, Person>,
) {
  const person = booking.client_id ? people.get(booking.client_id) : undefined;
  return {
    name: booking.guest_name ?? person?.name ?? null,
    phone: booking.guest_phone ?? person?.phone ?? null,
    email: person?.email ?? null,
    contact: booking.guest_contact,
  };
}

function peopleOf(
  practice: Pick<PracticeDump, "clients" | "team" | "imported_clients">,
) {
  return new Map<string, Person>(
    [...practice.clients, ...practice.team, ...practice.imported_clients].map(
      (person) => [person.id, person],
    ),
  );
}

/**
 * Clients with a cabinet, then guests from the bookings: staff booked them by
 * name and phone, so one person is one phone, or one name without a phone.
 */
export function clientsCsv(practices: PracticeDump[]) {
  const rows: Cell[][] = [];
  for (const practice of practices) {
    for (const client of practice.clients) {
      rows.push([
        practice.name,
        client.name,
        phoneCell(client.phone),
        client.email,
        client.credits,
        csvDate(client.created_at, practice.timezone),
        "Клиент с кабинетом",
      ]);
    }
    for (const card of practice.imported_clients) {
      rows.push([
        practice.name,
        card.name,
        phoneCell(card.phone),
        card.email,
        card.credits,
        csvDate(card.created_at, practice.timezone),
        "Перенесён из другого сервиса",
      ]);
    }
    const guests = new Map<string, Booking>();
    for (const booking of practice.bookings) {
      if (booking.client_id || !booking.guest_name) continue;
      const key = booking.guest_phone ?? booking.guest_name;
      if (!guests.has(key)) guests.set(key, booking);
    }
    for (const guest of guests.values()) {
      rows.push([
        practice.name,
        guest.guest_name,
        phoneCell(guest.guest_phone),
        guest.guest_contact,
        null,
        csvDate(guest.created_at, practice.timezone),
        "Гость",
      ]);
    }
  }
  return toCsv(
    [
      "Практика",
      "Имя",
      "Телефон",
      "Почта или контакт",
      "На балансе",
      "Клиент с",
      "Тип",
    ],
    rows,
  );
}

export function appointmentsCsv(practices: PracticeDump[]) {
  const rows: Cell[][] = [];
  for (const practice of practices) {
    const people = peopleOf(practice);
    for (const booking of practice.bookings) {
      const person = bookingPerson(booking, people);
      rows.push([
        practice.name,
        csvDate(booking.starts_at, practice.timezone),
        csvDate(booking.ends_at, practice.timezone),
        practice.timezone,
        kindLabel(booking.kind, practice.profession),
        booking.status === "cancelled"
          ? "Отменена"
          : booking.hold_until
            ? "Ждёт оплаты"
            : "Активна",
        booking.cancel_reason ? CANCEL_REASONS[booking.cancel_reason] : null,
        person.name,
        phoneCell(person.phone),
        person.email,
        person.contact,
        booking.note,
        booking.answers
          ?.map(({ question, answer }) => `${question}: ${answer}`)
          .join("\n"),
        booking.meeting_url,
        booking.series_id ? "Да" : "Нет",
      ]);
    }
  }
  return toCsv(
    [
      "Практика",
      "Начало",
      "Конец",
      "Часовой пояс",
      "Услуга",
      "Статус",
      "Причина отмены",
      "Клиент",
      "Телефон",
      "Почта",
      "Другой контакт",
      "Комментарий",
      "Ответы анкеты",
      "Ссылка на встречу",
      "Повторная запись",
    ],
    rows,
  );
}

/**
 * Synoro has no list of services: the paid hour and the free intro are built
 * in, and a price exists only for what is sold online, the packages.
 */
function servicesCsv(practices: PracticeDump[]) {
  const rows: Cell[][] = [];
  for (const practice of practices) {
    const terms = professionTerms(practice.profession);
    rows.push([
      practice.name,
      capitalize(terms.credit[0]),
      60,
      1,
      null,
      "Списывает занятие с баланса",
    ]);
    rows.push([
      practice.name,
      terms.free,
      practice.intro_minutes,
      0,
      null,
      practice.free_booking_enabled
        ? "Бесплатно, клиенты записываются сами"
        : "Бесплатно, записывает специалист",
    ]);
    for (const row of practice.packages) {
      rows.push([
        practice.name,
        `Пакет: ${row.credits}`,
        null,
        row.credits,
        rublesCell(row.price_kopecks),
        "Оплата онлайн",
      ]);
    }
  }
  return toCsv(
    ["Практика", "Услуга", "Минут", "Занятий", "Цена, ₽", "Примечание"],
    rows,
  );
}

/**
 * The practice's income between `from` and `to`, for the tax return: online
 * payments that went through and money received outside Synoro, by the day
 * it came, oldest first.
 */
export function incomeCsv(practice: PracticeDump, from: Date, to: Date) {
  const people = peopleOf(practice);
  const terms = professionTerms(practice.profession as Profession);
  const within = (at: string | null) =>
    at !== null && new Date(at) >= from && new Date(at) < to;
  const rows: { at: string; cells: Cell[] }[] = [];
  for (const payment of practice.payments) {
    if (payment.status !== "succeeded" || !within(payment.paid_at)) continue;
    rows.push({
      at: payment.paid_at as string,
      cells: [
        csvDate(payment.paid_at, practice.timezone),
        payment.client_id ? people.get(payment.client_id)?.name : null,
        rublesCell(payment.amount_kopecks),
        `Онлайн, ${PROVIDERS[payment.provider]}`,
        `Пакет: ${payment.credits} ${terms.credit[2]}`,
        payment.external_id,
      ],
    });
  }
  const bookings = new Map(practice.bookings.map((b) => [b.id, b] as const));
  for (const payment of practice.offline_payments) {
    if (!within(payment.paid_at)) continue;
    const booking = payment.booking_id
      ? bookings.get(payment.booking_id)
      : undefined;
    const package_ = payment.credits;
    rows.push({
      at: payment.paid_at,
      cells: [
        csvDate(payment.paid_at, practice.timezone),
        payment.client_id ? people.get(payment.client_id)?.name : null,
        rublesCell(payment.amount_kopecks),
        OFFLINE_PAYMENT_METHOD_LABELS[payment.method],
        booking
          ? `Запись ${csvDate(booking.starts_at, practice.timezone)}`
          : package_
            ? `Пакет: ${package_} ${terms.credit[2]}`
            : payment.note,
        null,
      ],
    });
  }
  // By the moment, not the text: imported dates may carry other offsets.
  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return toCsv(
    ["Дата", "Клиент", "Сумма, ₽", "Способ", "За что", "Номер операции"],
    rows.map((row) => row.cells),
  );
}

/** Who accepted which document and when: the proof, as a table. */
function consentsCsv(practices: PracticeDump[]) {
  const rows: Cell[][] = [];
  for (const practice of practices) {
    const people = peopleOf(practice);
    for (const consent of practice.consents) {
      rows.push([
        practice.name,
        consent.client_id ? people.get(consent.client_id)?.name : null,
        consent.document_title,
        consent.document_version,
        csvDate(consent.accepted_at, practice.timezone),
        consent.ip,
        consent.user_agent,
        consent.minor_name,
        consent.representative_name,
      ]);
    }
  }
  return toCsv(
    [
      "Практика",
      "Клиент",
      "Документ",
      "Версия",
      "Принято",
      "IP-адрес",
      "Браузер",
      "За ребёнка",
      "Представитель",
    ],
    rows,
  );
}

/** Clients' online payments, then what the specialist paid Synoro. */
function paymentsCsv(dump: AccountDump) {
  const rows: Cell[][] = [];
  for (const practice of dump.practices) {
    const people = peopleOf(practice);
    for (const payment of practice.payments) {
      const person = payment.client_id
        ? people.get(payment.client_id)
        : undefined;
      rows.push([
        practice.name,
        "Оплата клиента онлайн",
        csvDate(payment.created_at, practice.timezone),
        csvDate(payment.paid_at, practice.timezone),
        person?.name,
        payment.credits,
        rublesCell(payment.amount_kopecks),
        PAYMENT_STATUSES[payment.status],
        PROVIDERS[payment.provider],
        payment.external_id,
      ]);
    }
  }
  for (const practice of dump.practices) {
    const people = peopleOf(practice);
    for (const payment of practice.offline_payments) {
      rows.push([
        practice.name,
        "Оплата клиента вне Synoro",
        csvDate(payment.created_at, practice.timezone),
        csvDate(payment.paid_at, practice.timezone),
        payment.client_id ? people.get(payment.client_id)?.name : null,
        payment.credits,
        rublesCell(payment.amount_kopecks),
        "Получена",
        OFFLINE_PAYMENT_METHOD_LABELS[payment.method],
        null,
      ]);
    }
  }
  // The account's own payments have no practice to take the zone from.
  const zone = dump.practices[0]?.timezone ?? "Europe/Moscow";
  for (const payment of dump.subscription_payments) {
    rows.push([
      null,
      payment.period === "year" ? "«Про» на год" : "«Про» на месяц",
      csvDate(payment.created_at, zone),
      csvDate(payment.paid_at, zone),
      null,
      null,
      rublesCell(payment.amount_kopecks),
      payment.refunded_at ? "Возвращён" : PAYMENT_STATUSES[payment.status],
      "Точка Банк",
      payment.external_id,
    ]);
  }
  for (const order of dump.slug_orders) {
    rows.push([
      null,
      `Адрес ${order.slug}`,
      csvDate(order.created_at, zone),
      csvDate(order.paid_at, zone),
      null,
      null,
      rublesCell(order.amount_kopecks),
      PAYMENT_STATUSES[order.status],
      "Точка Банк",
      order.external_id,
    ]);
  }
  return toCsv(
    [
      "Практика",
      "Назначение",
      "Создан",
      "Оплачен",
      "Клиент",
      "Занятий",
      "Сумма, ₽",
      "Статус",
      "Через кого",
      "Номер операции",
    ],
    rows,
  );
}

/**
 * Calendar events of bookings. With `showNames` off an event only says
 * «Запись»: the feed's calendar is someone else's server, and may be shared.
 */
export function bookingEvents(
  practice: {
    name: string;
    profession: Profession;
    video_url?: string | null;
  },
  bookings: Booking[],
  people: Map<string, Person>,
  showNames: boolean,
): CalendarEvent[] {
  return bookings.map((booking) => {
    const base = {
      id: booking.id,
      startsAt: new Date(booking.starts_at),
      endsAt: new Date(booking.ends_at),
      cancelled: booking.status === "cancelled",
    };
    if (booking.kind === "blocked") {
      return { ...base, summary: "Закрытое время" };
    }
    if (!showNames) return { ...base, summary: "Запись" };

    const person = bookingPerson(booking, people);
    const what = kindLabel(booking.kind, practice.profession);
    const url = booking.meeting_url ?? practice.video_url;
    return {
      ...base,
      summary: person.name ? `${what} — ${person.name}` : what,
      description: [
        url && `Видеовстреча: ${url}`,
        person.phone && `Телефон: ${person.phone}`,
        person.contact && `Контакт: ${person.contact}`,
        booking.note && `Комментарий: ${booking.note}`,
      ]
        .filter(Boolean)
        .join("\n"),
      url: url ?? null,
    };
  });
}

function calendarIcs(dump: AccountDump, now = new Date()) {
  const events = dump.practices.flatMap((practice) =>
    bookingEvents(practice, practice.bookings, peopleOf(practice), true),
  );
  return buildCalendar(`Synoro: ${dump.account.name}`, events, now);
}

/** The whole archive: tables, the machine-readable dump, a calendar, a guide. */
export function fullArchive(dump: AccountDump, now = new Date()) {
  return zipSync({
    "clients.csv": strToU8(clientsCsv(dump.practices)),
    "appointments.csv": strToU8(appointmentsCsv(dump.practices)),
    "services.csv": strToU8(servicesCsv(dump.practices)),
    "payments.csv": strToU8(paymentsCsv(dump)),
    "consents.csv": strToU8(consentsCsv(dump.practices)),
    "data.json": strToU8(JSON.stringify(dump, null, 2)),
    "calendar.ics": strToU8(calendarIcs(dump, now)),
    "README.txt": strToU8(README_FULL),
  });
}

/** The weekly copy: the client base only. */
export function clientsArchive(dump: AccountDump) {
  return zipSync({
    "clients.csv": strToU8(clientsCsv(dump.practices)),
    "README.txt": strToU8(README_CLIENTS),
  });
}

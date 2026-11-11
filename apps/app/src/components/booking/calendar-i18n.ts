import type { EventCalendarI18nOverrides } from "@synoro/ui/reui/event-calendar/event-calendar-i18n";
import { format, isSameMonth, isSameYear, subMilliseconds } from "date-fns";

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const pluralRecords = (n: number) =>
  `${n} ${plural(n, "запись", "записи", "записей")}`;

/** Russian labels and 24-hour formats for the ReUI event calendar. */
export const calendarI18n: EventCalendarI18nOverrides = {
  labels: {
    today: "Сегодня",
    previous: "Назад",
    next: "Вперёд",
    addEvent: "Добавить",
    allDay: "Весь день",
    more: (count) => `ещё ${count}`,
    noEvents: "Записей нет",
    loading: "Загрузка",
    event: "запись",
    events: pluralRecords,
    selectView: "Вид",
    week: (weekNumber) => `Нед. ${weekNumber}`,
    resources: "Ресурсы",
    goToDate: "Перейти к дате",
    dropNotAllowed: "Сюда нельзя",
    continues: "продолжается",
    timeFrom: (time) => `с ${time}`,
    timeUntil: (time) => `до ${time}`,
    toggleDayEvents: pluralRecords,
    moreCompact: (count) => `+${count}`,
    timeRange: (from, to) => `${from}–${to}`,
  },
  viewNames: {
    month: "Месяц",
    week: "Неделя",
    day: "День",
    days: (count) => `${count} ${plural(count, "день", "дня", "дней")}`,
    agenda: "Список",
  },
  formats: {
    monthTitle: "LLLL yyyy",
    dayTitle: "EEEE, d MMMM yyyy",
    timeGridDayHeader: "EEEEEE d",
    agendaDayHeader: "EEEE, d MMMM",
    moreDayHeader: "EEEE, d MMMM",
    timeGutter: "HH:mm",
    timeGutterMinute: "HH:mm",
    eventTime: "HH:mm",
  },
  functions: {
    // Russian order: "26–31 октября 2026", "26 окт. – 1 нояб. 2026".
    formatTitle: (view, { date, activeRange, locale }) => {
      const opts = { locale };
      if (view === "month") return format(date, "LLLL yyyy", opts);
      if (view === "day" || view === "resource") {
        return format(date, "EEEE, d MMMM yyyy", opts);
      }
      const start = activeRange.start;
      const end = subMilliseconds(activeRange.end, 1);
      if (isSameMonth(start, end)) {
        return `${format(start, "d", opts)}–${format(end, "d MMMM yyyy", opts)}`;
      }
      if (isSameYear(start, end)) {
        return `${format(start, "d MMM", opts)} – ${format(end, "d MMM yyyy", opts)}`;
      }
      return `${format(start, "d MMM yyyy", opts)} – ${format(end, "d MMM yyyy", opts)}`;
    },
    formatEventTime: (start, end, allDay, opts) =>
      allDay
        ? "Весь день"
        : `${format(start, "HH:mm", opts)}–${format(end, "HH:mm", opts)}`,
    formatDayRange: (range, opts) =>
      `${format(range.start, "d MMM", opts)} – ${format(subMilliseconds(range.end, 1), "d MMM", opts)}`,
  },
};

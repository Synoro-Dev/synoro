"use client";

import {
  TimePicker,
  type TimePickerI18nOverrides,
} from "@synoro/ui/reui/time-picker";

import { minutesToTime } from "./time";

const RU: TimePickerI18nOverrides = {
  labels: {
    placeholder: "Время",
    hour: "Часы",
    minute: "Минуты",
    now: "Сейчас",
    clear: "Сбросить",
    confirm: "OK",
    panelLabel: "Выберите время",
    openPicker: "Открыть выбор времени",
  },
};

/**
 * Half-hour time of day as minutes since midnight, on the ReUI time picker.
 * `endOfDay` lets "00:00" stand for 24:00, the end of a working day.
 */
export function TimeSelect({
  value,
  onChange,
  label,
  endOfDay = false,
  disabled,
}: {
  value: number;
  onChange: (minute: number) => void;
  label: string;
  endOfDay?: boolean;
  disabled?: boolean;
}) {
  return (
    <TimePicker
      aria-label={label}
      className="w-24"
      minuteStep={30}
      disabled={disabled}
      i18n={RU}
      value={minutesToTime(value % 1440)}
      onValueChange={(next) => {
        if (!next) return;
        const [h = 0, m = 0] = next.split(":").map(Number);
        const minute = h * 60 + m;
        onChange(endOfDay && minute === 0 ? 1440 : minute);
      }}
    />
  );
}

"use client";

import { minutesToTime } from "./time";

const HALF_HOURS = Array.from({ length: 49 }, (_, i) => i * 30);

/** Native select of half-hour times ("10:30"), as minutes since midnight. */
export function TimeSelect({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (minute: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs dark:bg-input/30"
    >
      {HALF_HOURS.filter((m) => m >= min && m <= max).map((m) => (
        <option key={m} value={m}>
          {minutesToTime(m)}
        </option>
      ))}
    </select>
  );
}

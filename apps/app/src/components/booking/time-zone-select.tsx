"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@synoro/ui";
import { GlobeIcon } from "lucide-react";

import { timeZoneOptions } from "./time";

/**
 * A time zone to choose: every zone the browser knows, west to east, named in
 * Russian. `extra` zones (the viewer's, the practice's) are always listed.
 */
export function TimeZoneSelect({
  value,
  onChange,
  extra = [],
  disabled,
  className,
}: {
  value: string;
  onChange: (zone: string) => void;
  extra?: string[];
  disabled?: boolean;
  className?: string;
}) {
  const options = timeZoneOptions([value, ...extra]);
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => next && onChange(next)}
    >
      <SelectTrigger
        size="sm"
        aria-label="Часовой пояс"
        className={className ?? "w-auto max-w-full gap-1.5"}
      >
        <GlobeIcon className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        align="start"
        className="max-h-80 min-w-64"
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

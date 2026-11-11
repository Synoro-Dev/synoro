"use client";

import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  type ThemeMode,
  useTheme,
} from "@synoro/ui";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
  { value: "auto", label: "Как в системе" },
];

/** The look of the app, as items of a profile menu. */
export function ThemeMenuItems() {
  const { themeMode, setTheme } = useTheme();
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Тема</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={themeMode}
        onValueChange={(value) => setTheme(value as ThemeMode)}
      >
        {MODES.map((mode) => (
          <DropdownMenuRadioItem key={mode.value} value={mode.value}>
            {mode.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

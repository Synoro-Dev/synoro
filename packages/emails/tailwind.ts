import type { TailwindConfig } from "@react-email/components";

/**
 * The app's ReUI theme (`tooling/tailwind/theme.css`, light mode) as hex:
 * email clients understand neither `oklch()` nor CSS variables, and
 * `color-mix()` (Tailwind's `/10` opacity) fails in most of them, so state
 * tints are precomputed over white — `bg-success/10` → `success-tint`.
 */
export const emailTailwindConfig = {
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#ffffff",

      // Page behind the card; one step below `background`.
      canvas: "#fafafa",
      background: "#ffffff",
      foreground: "#0a0a0a",
      card: "#ffffff",
      primary: "#171717",
      "primary-foreground": "#fafafa",
      "primary-tint": "#e8e8e8",
      muted: "#f5f5f5",
      "muted-foreground": "#737373",
      border: "#e5e5e5",

      success: "#10b981",
      "success-foreground": "#064e3b",
      "success-tint": "#e7f8f2",
      "success-border": "#dbf5ec",
      info: "#8b5cf6",
      "info-foreground": "#4c1d95",
      "info-tint": "#f3effe",
      "info-border": "#eee7fe",
      warning: "#eab308",
      "warning-foreground": "#713f12",
      "warning-tint": "#fdf7e6",
      "warning-border": "#fcf4da",
      destructive: "#e7000b",
      "destructive-foreground": "#9f0712",
      "destructive-tint": "#fde6e7",
      "destructive-border": "#fbd9da",
    },
    fontFamily: {
      sans: [
        "Geist",
        "-apple-system",
        "BlinkMacSystemFont",
        '"Segoe UI"',
        "Roboto",
        "Helvetica",
        "Arial",
        "sans-serif",
      ],
      mono: [
        '"Geist Mono"',
        "ui-monospace",
        "SFMono-Regular",
        "Menlo",
        "Consolas",
        "monospace",
      ],
    },
    borderRadius: {
      none: "0",
      sm: "6px",
      md: "8px",
      lg: "10px",
      xl: "14px",
      full: "9999px",
    },
    fontSize: {
      xs: ["12px", { lineHeight: "16px" }],
      sm: ["14px", { lineHeight: "20px" }],
      base: ["16px", { lineHeight: "24px" }],
      lg: ["18px", { lineHeight: "28px" }],
      xl: ["20px", { lineHeight: "28px" }],
      "2xl": ["24px", { lineHeight: "32px" }],
      "3xl": ["30px", { lineHeight: "36px" }],
    },
    spacing: {
      px: "1px",
      0: "0",
      0.5: "2px",
      1: "4px",
      1.5: "6px",
      2: "8px",
      2.5: "10px",
      3: "12px",
      3.5: "14px",
      4: "16px",
      5: "20px",
      6: "24px",
      7: "28px",
      8: "32px",
      9: "36px",
      10: "40px",
      12: "48px",
      14: "56px",
      16: "64px",
    },
  },
} satisfies TailwindConfig;

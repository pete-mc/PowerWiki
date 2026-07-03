import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

/**
 * Determines whether Azure DevOps is currently showing a dark or light theme by
 * inspecting the CSS variables the host injects (see the SDK's applyTheme). This
 * measures actual background/text luminance rather than matching theme names, so
 * it works for the built-in light/dark themes and custom themes alike.
 */
export function resolveThemeMode(): ThemeMode {
  const root = getComputedStyle(document.documentElement);

  const backgroundLuminance = colorLuminance(root.getPropertyValue("--background-color"));
  if (backgroundLuminance !== undefined) {
    return backgroundLuminance < 0.5 ? "dark" : "light";
  }

  // Fall back to the text color: light text implies a dark theme.
  const textLuminance = colorLuminance(root.getPropertyValue("--text-primary-color"));
  if (textLuminance !== undefined) {
    return textLuminance > 0.5 ? "dark" : "light";
  }

  return "light";
}

/** React hook returning the current theme mode, updating on host theme changes. */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(resolveThemeMode);

  useEffect(() => {
    const update = () => setMode(resolveThemeMode());
    // Azure DevOps re-injects the theme variables (and dispatches themeApplied on
    // window) both on load and whenever the user switches theme.
    window.addEventListener("themeApplied", update);
    window.addEventListener("themeChanged", update);
    return () => {
      window.removeEventListener("themeApplied", update);
      window.removeEventListener("themeChanged", update);
    };
  }, []);

  return mode;
}

/**
 * Resolves a CSS color string (in any form the browser accepts) to its relative
 * luminance in [0, 1], or undefined when it can't be parsed.
 */
function colorLuminance(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const probe = document.createElement("span");
  probe.style.color = trimmed;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  const channels = computed.match(/[\d.]+/g);
  if (!channels || channels.length < 3) {
    return undefined;
  }

  const [r, g, b] = channels.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

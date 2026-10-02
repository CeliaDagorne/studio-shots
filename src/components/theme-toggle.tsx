"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  THEME_STORAGE_KEY,
  resolveThemePreference,
  type ThemePreference,
} from "@/lib/theme";

import styles from "./theme-toggle.module.css";

const subscribe = (onStoreChange: () => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      onStoreChange();
    }
  };
  const onTheme = () => onStoreChange();
  media.addEventListener("change", onStoreChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("studio-shots-theme", onTheme);
  return () => {
    media.removeEventListener("change", onStoreChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("studio-shots-theme", onTheme);
  };
};

const readTheme = (): ThemePreference => {
  if (typeof document === "undefined") {
    return "light";
  }
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") {
    return attr;
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return resolveThemePreference(
    stored,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
};

const applyTheme = (theme: ThemePreference) => {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new Event("studio-shots-theme"));
};

export const ThemeToggle = () => {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as ThemePreference);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const nextTheme: ThemePreference = theme === "dark" ? "light" : "dark";
  const label = mounted
    ? theme === "dark"
      ? "Switch to light mode"
      : "Switch to dark mode"
    : "Toggle color theme";

  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={label}
      title={label}
      onClick={() => applyTheme(nextTheme)}
    >
      <span className={styles.icon} aria-hidden="true">
        {mounted && theme === "dark" ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path
              d="M12 4.5V3m0 18v-1.5M5.6 5.6 4.5 4.5m14.9 14.9-1.1-1.1M4.5 12H3m18 0h-1.5M5.6 18.4 4.5 19.5m14.9-14.9-1.1 1.1M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path
              d="M20.5 14.2A7.7 7.7 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
};

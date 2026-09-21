"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";

export type AppSettings = {
  theme: ThemeMode;
  density: "comfortable" | "compact";
  animations: boolean;
  showLiveBadge: boolean;
  showCameraOverlay: boolean;
  showPersianDigits: boolean;
  gridColumns: 2 | 3 | 4;
  sidebarCollapsed: boolean;
  reduceMotion: boolean;
  accentStyle: "brand" | "iran";
  // camera / technical (synced with backend when available)
  frameWidth: number;
  frameHeight: number;
  jpegQuality: number;
  fpsLimit: number;
  rtspTransport: "tcp" | "udp";
  rtspTimeoutSec: number;
  autoReconnect: boolean;
  lowLatency: boolean;
  snapshotOnAlarm: boolean;
  retentionDays: number;
  apiBaseUrl: string;
};

const DEFAULTS: AppSettings = {
  theme: "system",
  density: "comfortable",
  animations: true,
  showLiveBadge: true,
  showCameraOverlay: true,
  showPersianDigits: true,
  gridColumns: 2,
  sidebarCollapsed: false,
  reduceMotion: false,
  accentStyle: "brand",
  frameWidth: 640,
  frameHeight: 360,
  jpegQuality: 75,
  fpsLimit: 15,
  rtspTransport: "tcp",
  rtspTimeoutSec: 5,
  autoReconnect: true,
  lowLatency: true,
  snapshotOnAlarm: true,
  retentionDays: 30,
  apiBaseUrl: "http://localhost:9000",
};

const STORAGE_KEY = "parscam-settings-v1";

type SettingsContextValue = {
  settings: AppSettings;
  resolvedTheme: "light" | "dark";
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
  setTheme: (theme: ThemeMode) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readStored(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = readStored();
    setSettings(stored);
    setResolvedTheme(resolveTheme(stored.theme));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    const theme = resolveTheme(settings.theme);
    setResolvedTheme(theme);
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.dataset.density = settings.density;
    root.dataset.accent = settings.accentStyle;
    root.classList.toggle("reduce-motion", settings.reduceMotion || !settings.animations);

    if (settings.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        const next = resolveTheme("system");
        setResolvedTheme(next);
        root.classList.toggle("dark", next === "dark");
        root.dataset.theme = next;
      };
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
  }, [settings, hydrated]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULTS), []);
  const setTheme = useCallback((theme: ThemeMode) => {
    setSettings((prev) => ({ ...prev, theme }));
  }, []);

  const value = useMemo(
    () => ({ settings, resolvedTheme, update, reset, setTheme }),
    [settings, resolvedTheme, update, reset, setTheme],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export { DEFAULTS as defaultSettings };

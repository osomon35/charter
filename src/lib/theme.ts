export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "charter-theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Runs before the page paints, as the first thing in <body>.
 *
 * Without this the server sends light markup, React hydrates, and only then
 * does the stored preference apply — a white flash on every navigation for
 * anyone using dark mode. Deliberately dependency-free and synchronous.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var dark = theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    /* Private mode, blocked storage — light is a fine default. */
  }
})();
`.trim();

/** Applies a choice to the document and remembers it. */
export function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("dark", dark);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Nothing to do — the choice just will not survive a reload.
  }
}

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

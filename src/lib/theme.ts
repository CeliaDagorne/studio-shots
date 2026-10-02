/** Client theme preference for the Studio Shots marketing site. */
export const THEME_STORAGE_KEY = "studio-shots-theme";

export type ThemePreference = "light" | "dark";

/**
 * Inline script run before paint. Must stay free of secrets and imports.
 * Sets data-theme + color-scheme from localStorage or prefers-color-scheme.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(()=>{try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var s=localStorage.getItem(k);var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var d=document.documentElement;d.setAttribute("data-theme",t);d.style.colorScheme=t;}catch(e){}})();`;

export const resolveThemePreference = (
  stored: string | null,
  prefersDark: boolean,
): ThemePreference => {
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return prefersDark ? "dark" : "light";
};

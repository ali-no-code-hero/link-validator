import type { BrowserContextOptions } from "playwright-core";

function acceptLanguageHeader(locale: string): string {
  const trimmed = locale.trim();
  const primary = trimmed.split(/[-_]/)[0]?.toLowerCase() ?? "en";
  return `${trimmed},${primary};q=0.9`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Desktop-like context aligned with optional env (locale / timezone / viewport).
 * Match LINK_VALIDATOR_BROWSER_* to your proxy egress region to reduce geo/locale mismatches.
 */
export function getTraceBrowserContextOptions(userAgent: string): BrowserContextOptions {
  const locale = process.env.LINK_VALIDATOR_BROWSER_LOCALE?.trim() || "en-US";
  const timezoneId = process.env.LINK_VALIDATOR_BROWSER_TIMEZONE?.trim();
  const width = parsePositiveInt(process.env.LINK_VALIDATOR_VIEWPORT_WIDTH, 1920);
  const height = parsePositiveInt(process.env.LINK_VALIDATOR_VIEWPORT_HEIGHT, 1080);

  return {
    userAgent,
    locale,
    ...(timezoneId ? { timezoneId } : {}),
    viewport: { width, height },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    colorScheme: "light",
    extraHTTPHeaders: {
      "Accept-Language": acceptLanguageHeader(locale),
    },
  };
}

/** Audit fields for extra_tracking_data (no secrets). */
export function getTraceBrowserProfileForExtras(): Record<string, unknown> {
  const locale = process.env.LINK_VALIDATOR_BROWSER_LOCALE?.trim() || "en-US";
  const timezoneId = process.env.LINK_VALIDATOR_BROWSER_TIMEZONE?.trim();
  const width = parsePositiveInt(process.env.LINK_VALIDATOR_VIEWPORT_WIDTH, 1920);
  const height = parsePositiveInt(process.env.LINK_VALIDATOR_VIEWPORT_HEIGHT, 1080);
  return {
    stealthPluginEnabled: process.env.LINK_VALIDATOR_STEALTH !== "0",
    browserLocale: locale,
    ...(timezoneId ? { browserTimezone: timezoneId } : {}),
    viewport: { width, height },
  };
}

/**
 * Realistic desktop Chrome UA to reduce bot-style 403s while still using Playwright.
 * Stored in click_logs.extra_tracking_data for audit; do not confuse with device id.
 */
export const REALISTIC_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

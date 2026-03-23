/**
 * Optional HTTP(S) / SOCKS5 proxy for Playwright and outbound IP checks.
 * Set LINK_VALIDATOR_PROXY_URL to a full URL with embedded credentials, e.g.:
 * http://user:pass@proxy.example.com:3120
 */

import type { BrowserContextOptions } from "playwright-core";

export function getOptionalProxyUrl(): string | null {
  const v = process.env.LINK_VALIDATOR_PROXY_URL?.trim();
  return v && v.length > 0 ? v : null;
}

/** Host only (no credentials) for logs. */
export function proxyEndpointForLog(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(invalid-proxy-url)";
  }
}

export type PlaywrightProxyConfig = NonNullable<BrowserContextOptions["proxy"]>;

/**
 * Playwright expects server + optional username/password (not user:pass in server string).
 */
export function parseProxyUrlForPlaywright(raw: string): PlaywrightProxyConfig {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("LINK_VALIDATOR_PROXY_URL must be a valid URL");
  }
  const protocol = u.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:" && protocol !== "socks5:") {
    throw new Error("LINK_VALIDATOR_PROXY_URL must use http, https, or socks5");
  }
  const server = `${u.protocol}//${u.host}`;
  const username = u.username ? decodeURIComponent(u.username) : undefined;
  const password = u.password ? decodeURIComponent(u.password) : undefined;
  return {
    server,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

export function getPlaywrightProxyFromEnv(): PlaywrightProxyConfig | undefined {
  const raw = getOptionalProxyUrl();
  if (!raw) {
    return undefined;
  }
  return parseProxyUrlForPlaywright(raw);
}

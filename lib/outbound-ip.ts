import { ProxyAgent, fetch as undiciFetch } from "undici";
import { logError, logWarn } from "@/lib/server-log";

const DEFAULT_IP_URL = "https://api.ipify.org?format=json";

function isLikelyIpv4(s: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(s);
}

async function parseIpFromResponse(res: {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}): Promise<string | null> {
  if (!res.ok) {
    logWarn("outbound-ip", "non_ok_response", { status: res.status });
    return null;
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await res.json()) as { ip?: string; query?: string };
    if (typeof j.ip === "string") {
      return j.ip;
    }
    if (typeof j.query === "string" && isLikelyIpv4(j.query)) {
      return j.query;
    }
  }
  const text = (await res.text()).trim();
  if (isLikelyIpv4(text)) {
    return text;
  }
  try {
    const j = JSON.parse(text) as { ip?: string };
    if (typeof j.ip === "string") {
      return j.ip;
    }
  } catch {
    // not JSON
  }
  const firstLine = text.split("\n")[0]?.trim();
  if (firstLine && isLikelyIpv4(firstLine)) {
    return firstLine;
  }
  return null;
}

/**
 * When `proxyUrl` is set, uses undici + ProxyAgent so the check egresses through the same
 * residential proxy as Playwright. Otherwise uses global fetch.
 */
export async function fetchOutboundIp(proxyUrl: string | null): Promise<string | null> {
  const checkUrl = process.env.LINK_VALIDATOR_OUTBOUND_IP_URL?.trim() || DEFAULT_IP_URL;
  try {
    if (proxyUrl) {
      const dispatcher = new ProxyAgent(proxyUrl);
      const res = await undiciFetch(checkUrl, { dispatcher });
      return await parseIpFromResponse(res);
    }
    const res = await fetch(checkUrl, { cache: "no-store" });
    return await parseIpFromResponse(res);
  } catch (e) {
    logError("outbound-ip", "fetch_failed", e, {
      viaProxy: Boolean(proxyUrl),
    });
    return null;
  }
}

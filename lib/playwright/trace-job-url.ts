import type { Frame, Request, Response } from "playwright-core";
import type { RedirectChainEntry } from "@/lib/types/database";
import { launchChromiumBrowser } from "@/lib/playwright/launch-browser";

export const LINK_VALIDATOR_USER_AGENT = "Link Validator - CollabWork";

const GOTO_TIMEOUT_MS = 50_000;

function dedupeChain(chain: RedirectChainEntry[]): RedirectChainEntry[] {
  const out: RedirectChainEntry[] = [];
  for (const step of chain) {
    const prev = out[out.length - 1];
    if (prev && prev.url === step.url) {
      continue;
    }
    out.push(step);
  }
  return out;
}

function walkRedirectedRequests(finalRequest: Request): string[] {
  const urls: string[] = [];
  let r: Request | null = finalRequest;
  while (r) {
    urls.unshift(r.url());
    r = r.redirectedFrom();
  }
  return urls;
}

async function getOutboundIp(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (!res.ok) {
      return null;
    }
    const j = (await res.json()) as { ip?: string };
    return typeof j.ip === "string" ? j.ip : null;
  } catch {
    return null;
  }
}

function utmFromUrl(urlString: string): Record<string, string> {
  try {
    const u = new URL(urlString);
    const out: Record<string, string> = {};
    u.searchParams.forEach((value, key) => {
      if (key.toLowerCase().startsWith("utm_")) {
        out[key] = value;
      }
    });
    return out;
  } catch {
    return {};
  }
}

export type TraceJobResult = {
  initial_url: string;
  final_destination_url: string | null;
  redirect_chain: RedirectChainEntry[];
  ip_address_used: string | null;
  user_agent_device_id: string;
  status_code: number | null;
  extra_tracking_data: Record<string, unknown>;
};

export async function traceJobUrl(initialUrl: string, deviceId: string): Promise<TraceJobResult> {
  const ip_address_used = await getOutboundIp();
  const extra: Record<string, unknown> = {
    userAgent: LINK_VALIDATOR_USER_AGENT,
    deviceId,
  };

  const browser = await launchChromiumBrowser();
  try {
    const context = await browser.newContext({
      userAgent: LINK_VALIDATOR_USER_AGENT,
    });
    const page = await context.newPage();

    const frameNavUrls: string[] = [];
    const onFrameNav = (frame: Frame) => {
      if (frame === page.mainFrame() && frame.url() && frame.url() !== "about:blank") {
        frameNavUrls.push(frame.url());
      }
    };
    page.on("framenavigated", onFrameNav);

    let final_destination_url: string | null = null;
    let status_code: number | null = null;
    const redirect_chain: RedirectChainEntry[] = [];

    try {
      const response: Response | null = await page.goto(initialUrl, {
        waitUntil: "domcontentloaded",
        timeout: GOTO_TIMEOUT_MS,
      });
      final_destination_url = page.url();
      status_code = response?.status() ?? null;

      if (response) {
        const req = response.request();
        const httpUrls = walkRedirectedRequests(req);
        for (let i = 0; i < httpUrls.length; i++) {
          const u = httpUrls[i]!;
          const isLast = i === httpUrls.length - 1;
          redirect_chain.push({
            url: u,
            type: "http_redirect",
            status: isLast ? response.status() : undefined,
          });
        }
      }

      for (const u of frameNavUrls) {
        redirect_chain.push({ url: u, type: "navigation" });
      }

      const finalUrl = page.url();
      if (finalUrl && finalUrl !== "about:blank") {
        redirect_chain.push({
          url: finalUrl,
          type: "navigation",
          status: status_code ?? undefined,
        });
      }

      if (final_destination_url) {
        extra.utm = utmFromUrl(final_destination_url);
      }

      try {
        const cookies = await context.cookies();
        extra.cookieNames = cookies.slice(0, 40).map((c) => c.name);
      } catch {
        extra.cookieNames = [];
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      extra.error = message;
      extra.failureStage = "goto_or_navigation";
      final_destination_url = page.url() !== "about:blank" ? page.url() : null;
      if (frameNavUrls.length > 0) {
        extra.lastNavigationUrl = frameNavUrls[frameNavUrls.length - 1];
      }
      for (const u of frameNavUrls) {
        redirect_chain.push({ url: u, type: "navigation" });
      }
    }

    return {
      initial_url: initialUrl,
      final_destination_url,
      redirect_chain: dedupeChain(redirect_chain),
      ip_address_used,
      user_agent_device_id: deviceId,
      status_code,
      extra_tracking_data: extra,
    };
  } finally {
    await browser.close();
  }
}

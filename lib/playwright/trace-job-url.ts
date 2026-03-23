import type { Frame, Page, Request, Response } from "playwright-core";
import type { RedirectChainEntry } from "@/lib/types/database";
import { compareDirectAndProxyEgress, fetchOutboundIp } from "@/lib/outbound-ip";
import { launchChromiumBrowser } from "@/lib/playwright/launch-browser";
import {
  getOptionalProxyUrl,
  getPlaywrightProxyFromEnv,
  proxyEndpointForLog,
} from "@/lib/proxy";
import { logError, logInfo, logWarn, truncateUrl } from "@/lib/server-log";
import {
  getTraceBrowserContextOptions,
  getTraceBrowserProfileForExtras,
} from "@/lib/browser-context-options";
import { REALISTIC_BROWSER_USER_AGENT } from "@/lib/user-agent";

const GOTO_TIMEOUT_MS = 50_000;
const GOTO_INSUFFICIENT_RESOURCES_RETRIES = 2;
const GOTO_RETRY_BACKOFF_MS = 2500;
const MAX_RESPONSE_HEADER_KEYS = 24;

async function gotoWithInsufficientResourcesRetry(
  page: Page,
  url: string,
  extra: Record<string, unknown>,
): Promise<Response | null> {
  for (let i = 0; i < GOTO_INSUFFICIENT_RESOURCES_RETRIES; i++) {
    if (i > 0) {
      extra.gotoRetryAfterInsufficientResources = true;
      extra.gotoRetryAttempt = i + 1;
      logWarn("trace.goto", "retry_after_insufficient_resources", {
        attempt: i + 1,
        backoffMs: GOTO_RETRY_BACKOFF_MS,
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, GOTO_RETRY_BACKOFF_MS);
      });
    }
    try {
      return await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: GOTO_TIMEOUT_MS,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isInsufficient = /ERR_INSUFFICIENT_RESOURCES/i.test(msg);
      if (isInsufficient && i < GOTO_INSUFFICIENT_RESOURCES_RETRIES - 1) {
        continue;
      }
      throw e;
    }
  }
  throw new Error("gotoWithInsufficientResourcesRetry: exhausted attempts");
}

/** Drop consecutive identical steps only (same url, status, type) — keeps real redirect repeats. */
function dedupeConsecutiveIdentical(chain: RedirectChainEntry[]): RedirectChainEntry[] {
  const out: RedirectChainEntry[] = [];
  for (const step of chain) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.url === step.url &&
      prev.status === step.status &&
      prev.type === step.type
    ) {
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

function sampleResponseHeaders(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const headers = response.headers();
    let n = 0;
    for (const [k, v] of Object.entries(headers)) {
      if (n >= MAX_RESPONSE_HEADER_KEYS) {
        break;
      }
      const lower = k.toLowerCase();
      if (
        lower === "set-cookie" ||
        lower === "cookie" ||
        lower === "authorization" ||
        lower === "proxy-authorization"
      ) {
        continue;
      }
      out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
      n += 1;
    }
  } catch {
    // ignore
  }
  return out;
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
  const proxyUrl = getOptionalProxyUrl();
  const playwrightProxy = getPlaywrightProxyFromEnv();

  logInfo("trace", "start", {
    initialUrl: truncateUrl(initialUrl),
    deviceId,
    proxyEnabled: Boolean(playwrightProxy),
    ...(proxyUrl ? { proxyServer: proxyEndpointForLog(proxyUrl) } : {}),
  });

  const extra: Record<string, unknown> = {
    browserUserAgent: REALISTIC_BROWSER_USER_AGENT,
    clientInstrumentation: "CollabWork Link Validator",
    deviceId,
    proxyUsed: Boolean(playwrightProxy),
    ...getTraceBrowserProfileForExtras(),
    ...(proxyUrl ? { proxyServer: proxyEndpointForLog(proxyUrl) } : {}),
  };

  let ip_address_used: string | null = null;
  if (proxyUrl) {
    const egress = await compareDirectAndProxyEgress(proxyUrl);
    ip_address_used = egress.proxyIp;
    extra.proxyEgressCheck = {
      directEgressIp: egress.directIp,
      proxyEgressIp: egress.proxyIp,
      proxyIpDistinctFromDirect: egress.proxyIpDistinctFromDirect,
      proxySameAsDirectSuspected: egress.proxySameAsDirectSuspected,
    };
    if (egress.proxySameAsDirectSuspected) {
      logWarn("trace", "proxy_ip_matches_direct_egress", {
        ip: egress.directIp,
        proxyServer: proxyEndpointForLog(proxyUrl),
      });
    } else if (egress.proxyIpDistinctFromDirect) {
      logInfo("trace", "proxy_egress_distinct_from_direct", {
        direct: egress.directIp,
        proxy: egress.proxyIp,
      });
    }
  } else {
    ip_address_used = await fetchOutboundIp(null);
  }

  logInfo("trace", "outbound_ip", {
    ip: ip_address_used ?? "(null)",
    viaProxy: Boolean(proxyUrl),
  });

  const browser = await launchChromiumBrowser();
  try {
    const context = await browser.newContext({
      ...getTraceBrowserContextOptions(REALISTIC_BROWSER_USER_AGENT),
      ...(playwrightProxy ? { proxy: playwrightProxy } : {}),
    });
    const page = await context.newPage();

    /** Ordered list of every main-frame *document* response (each redirect hop is usually one). */
    const mainFrameDocumentHops: RedirectChainEntry[] = [];

    page.on("response", (response: Response) => {
      try {
        const req = response.request();
        if (req.frame() !== page.mainFrame()) {
          return;
        }
        if (req.resourceType() !== "document") {
          return;
        }
        const u = response.url();
        if (!u || u === "about:blank") {
          return;
        }
        const entry: RedirectChainEntry = {
          url: u,
          status: response.status(),
          type: "document_response",
        };
        mainFrameDocumentHops.push(entry);
        logInfo("trace.hop", "main_frame_document", {
          step: mainFrameDocumentHops.length - 1,
          url: truncateUrl(u),
          status: response.status(),
        });
      } catch {
        // ignore
      }
    });

    const frameNavUrls: string[] = [];
    const onFrameNav = (frame: Frame) => {
      if (frame === page.mainFrame() && frame.url() && frame.url() !== "about:blank") {
        frameNavUrls.push(frame.url());
      }
    };
    page.on("framenavigated", onFrameNav);

    let final_destination_url: string | null = null;
    let status_code: number | null = null;
    let finalResponseHeaders: Record<string, string> = {};
    const redirect_chain: RedirectChainEntry[] = [];

    try {
      logInfo("trace.goto", "before_goto", {
        initialUrl: truncateUrl(initialUrl),
        timeoutMs: GOTO_TIMEOUT_MS,
      });

      const response: Response | null = await gotoWithInsufficientResourcesRetry(
        page,
        initialUrl,
        extra,
      );

      final_destination_url = page.url();
      status_code = response?.status() ?? null;

      if (response) {
        finalResponseHeaders = sampleResponseHeaders(response);
      }

      if (!response) {
        logWarn("trace.goto", "response_null", {
          pageUrl: truncateUrl(page.url()),
          documentHopCount: mainFrameDocumentHops.length,
          note:
            "Playwright returned no Response object for page.goto; using document-response hops if any.",
        });
      } else {
        const req = response.request();
        const httpUrls = walkRedirectedRequests(req);
        logInfo("trace.goto", "after_goto", {
          finalUrl: truncateUrl(final_destination_url ?? ""),
          status: status_code,
          httpRedirectStepsFromRequest: httpUrls.length,
          documentHopCount: mainFrameDocumentHops.length,
          frameNavCount: frameNavUrls.length,
        });
      }

      if (mainFrameDocumentHops.length > 0) {
        redirect_chain.push(...mainFrameDocumentHops);
        extra.documentHopCount = mainFrameDocumentHops.length;
      } else if (response) {
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
        extra.documentHopCount = 0;
        extra.redirectChainSource = "fallback_http_and_frame";
      } else {
        for (const u of frameNavUrls) {
          redirect_chain.push({ url: u, type: "navigation" });
        }
        extra.documentHopCount = 0;
        extra.redirectChainSource = "frame_only_no_response";
      }

      if (final_destination_url) {
        extra.utm = utmFromUrl(final_destination_url);
      }

      if (Object.keys(finalResponseHeaders).length > 0) {
        extra.finalResponseHeadersSample = finalResponseHeaders;
      }

      if (typeof status_code === "number") {
        if (status_code >= 200 && status_code < 300) {
          extra.httpOutcome = "ok_2xx";
        } else if (status_code >= 300 && status_code < 400) {
          extra.httpOutcome = "redirect_3xx";
        } else if (status_code === 403 || status_code === 401) {
          extra.httpOutcome = "blocked_4xx";
          extra.partnerLikelyBlocked = true;
        } else if (status_code >= 400 && status_code < 500) {
          extra.httpOutcome = "client_error_4xx";
        } else if (status_code >= 500) {
          extra.httpOutcome = "server_error_5xx";
        }
      }

      try {
        const cookies = await context.cookies();
        extra.cookieNames = cookies.slice(0, 40).map((c) => c.name);
      } catch {
        extra.cookieNames = [];
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("trace.goto", "goto_threw", err, {
        initialUrl: truncateUrl(initialUrl),
        pageUrlAfter: truncateUrl(page.url()),
        documentHopCountBeforeError: mainFrameDocumentHops.length,
      });
      extra.error = message;
      extra.failureStage = "goto_or_navigation";
      final_destination_url = page.url() !== "about:blank" ? page.url() : null;
      if (mainFrameDocumentHops.length > 0) {
        redirect_chain.push(...mainFrameDocumentHops);
        extra.documentHopCount = mainFrameDocumentHops.length;
      }
      if (frameNavUrls.length > 0) {
        extra.lastNavigationUrl = frameNavUrls[frameNavUrls.length - 1];
      }
      for (const u of frameNavUrls) {
        redirect_chain.push({ url: u, type: "navigation" });
      }
    }

    const mergedChain = dedupeConsecutiveIdentical(redirect_chain);

    const result = {
      initial_url: initialUrl,
      final_destination_url,
      redirect_chain: mergedChain,
      ip_address_used,
      user_agent_device_id: deviceId,
      status_code,
      extra_tracking_data: extra,
    };

    logInfo("trace", "complete", {
      chainLength: result.redirect_chain.length,
      documentHopCount: mainFrameDocumentHops.length,
      finalUrl: truncateUrl(result.final_destination_url ?? ""),
      status: result.status_code,
      hasExtraError: Boolean(result.extra_tracking_data.error),
    });

    return result;
  } finally {
    await browser.close();
  }
}

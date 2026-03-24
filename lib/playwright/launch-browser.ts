import { existsSync } from "fs";
import path from "path";
import { addExtra } from "playwright-extra";
import { chromium as chromiumCore } from "playwright-core";
import type { Browser } from "playwright-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { registerStealthEvasionResolutions } from "@/lib/playwright/register-stealth-evasions";
import { logError, logInfo, logWarn, runtimeHints } from "@/lib/server-log";

/**
 * Default `playwright-extra` tries to require("playwright-core") at runtime; on Vercel
 * that resolution fails inside the serverless bundle. Patch the explicit core launcher.
 */
const chromium = addExtra(chromiumCore);

/** Set LINK_VALIDATOR_STEALTH=0 to disable evasions (debug only). */
if (process.env.LINK_VALIDATOR_STEALTH !== "0") {
  registerStealthEvasionResolutions(chromium.plugins);
  chromium.use(StealthPlugin());
}

function sparticuzBinDir(): string {
  return path.join(process.cwd(), "node_modules", "@sparticuz", "chromium", "bin");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function argFlagPrefix(arg: string): string {
  return arg.split("=")[0] ?? arg;
}

/** Replace Sparticuz disk/media cache flags; add --disable-dev-shm-usage when missing (serverless / small /tmp). */
function mergeSparticuzArgsForServerless(baseArgs: string[]): string[] {
  const stripPrefixes = ["--disk-cache-size", "--media-cache-size"];
  const filtered = baseArgs.filter((a) => {
    const f = argFlagPrefix(a);
    return !stripPrefixes.some((p) => f === p || a.startsWith(`${p}=`));
  });
  const out = [...filtered, "--disk-cache-size=1", "--media-cache-size=0"];
  if (!out.some((x) => argFlagPrefix(x) === "--disable-dev-shm-usage")) {
    out.push("--disable-dev-shm-usage");
  }
  return out;
}

/** Vercel: concurrent lambdas racing Sparticuz /tmp extract → ETXTBSY; also transient spawn failures. */
function isRetriableLaunchError(message: string): boolean {
  return (
    /ETXTBSY|EAGAIN|EBUSY|EMFILE|ENOMEM/i.test(message) ||
    /spawn .+ ETXTBSY/i.test(message) ||
    /Text file busy/i.test(message) ||
    /browserType\.launch/i.test(message)
  );
}

const MAX_LAUNCH_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAYS_MS = [0, 400, 1000, 2200, 4500];

async function launchSparticuzChromium(): Promise<Browser> {
  const hints = runtimeHints();
  logInfo("playwright.launch", "using_sparticuz_chromium", hints);

  const chromiumPack = (await import("@sparticuz/chromium")).default;
  const binDir = sparticuzBinDir();
  if (!existsSync(binDir)) {
    logWarn("playwright.launch", "chromium_bin_missing_at_cwd", {
      ...hints,
      cwd: process.cwd(),
      expectedBin: binDir,
    });
  }
  const executablePath = await chromiumPack.executablePath(existsSync(binDir) ? binDir : undefined);
  logInfo("playwright.launch", "chromium_executable", {
    ...hints,
    executablePathSuffix: executablePath.slice(-80),
  });
  /**
   * Sparticuz defaults include large `--disk-cache-size` (e.g. 32MB). Appending `--disk-cache-size=1`
   * without removing the existing flag is a no-op — we must strip then re-append so /tmp stays tiny.
   */
  const mergedArgs = mergeSparticuzArgsForServerless(chromiumPack.args as string[]);
  const browser = await chromium.launch({
    args: mergedArgs,
    executablePath,
    headless: true,
    ...(process.env.VERCEL
      ? {
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
        }
      : {}),
  });
  logInfo("playwright.launch", "launched_ok", hints);
  return browser;
}

async function launchLocalPlaywrightChromium(): Promise<Browser> {
  const hints = runtimeHints();
  logInfo("playwright.launch", "using_local_playwright_chromium", hints);
  const browser = await chromium.launch({ headless: true });
  logInfo("playwright.launch", "launched_ok", hints);
  return browser;
}

export async function launchChromiumBrowser(): Promise<Browser> {
  const hints = runtimeHints();

  if (process.env.VERCEL) {
    for (let attempt = 0; attempt < MAX_LAUNCH_ATTEMPTS; attempt++) {
      const delay = LAUNCH_RETRY_DELAYS_MS[attempt] ?? 4500;
      if (delay > 0) {
        await sleep(delay);
      }
      try {
        return await launchSparticuzChromium();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const retriable = isRetriableLaunchError(message);
        if (!retriable || attempt === MAX_LAUNCH_ATTEMPTS - 1) {
          logError("playwright.launch", "sparticuz_launch_failed", e, {
            ...hints,
            attempt: attempt + 1,
            retriable,
          });
          throw e;
        }
        logWarn("playwright.launch", "retry_after_launch_error", {
          ...hints,
          attempt: attempt + 1,
          nextDelayMs: LAUNCH_RETRY_DELAYS_MS[attempt + 1] ?? 0,
          messagePreview: message.slice(0, 240),
        });
      }
    }
    throw new Error("launchChromiumBrowser: exhausted retries (unexpected)");
  }

  try {
    return await launchLocalPlaywrightChromium();
  } catch (e) {
    logError("playwright.launch", "local_launch_failed", e, hints);
    throw e;
  }
}

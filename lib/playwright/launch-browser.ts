import type { Browser } from "playwright-core";
import { logError, logInfo, runtimeHints } from "@/lib/server-log";

export async function launchChromiumBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const hints = runtimeHints();

  if (process.env.VERCEL) {
    logInfo("playwright.launch", "using_sparticuz_chromium", hints);
    try {
      const chromiumPack = (await import("@sparticuz/chromium")).default;
      const executablePath = await chromiumPack.executablePath();
      logInfo("playwright.launch", "chromium_executable", {
        ...hints,
        executablePathSuffix: executablePath.slice(-80),
      });
      const browser = await chromium.launch({
        args: chromiumPack.args,
        executablePath,
        headless: true,
      });
      logInfo("playwright.launch", "launched_ok", hints);
      return browser;
    } catch (e) {
      logError("playwright.launch", "sparticuz_launch_failed", e, hints);
      throw e;
    }
  }

  logInfo("playwright.launch", "using_local_playwright_chromium", hints);
  try {
    const { chromium: localChromium } = await import("playwright");
    const browser = await localChromium.launch({ headless: true });
    logInfo("playwright.launch", "launched_ok", hints);
    return browser;
  } catch (e) {
    logError("playwright.launch", "local_launch_failed", e, hints);
    throw e;
  }
}

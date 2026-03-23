import type { Browser } from "playwright-core";

export async function launchChromiumBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  if (process.env.VERCEL) {
    const chromiumPack = (await import("@sparticuz/chromium")).default;
    return chromium.launch({
      args: chromiumPack.args,
      executablePath: await chromiumPack.executablePath(),
      headless: true,
    });
  }
  const { chromium: localChromium } = await import("playwright");
  return localChromium.launch({ headless: true });
}

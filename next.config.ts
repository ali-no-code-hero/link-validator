import type { NextConfig } from "next";

/**
 * @sparticuz/chromium ships brotli-compressed binaries under node_modules/.../bin.
 * Next.js output file tracing does not pull those in by default, so Vercel's
 * /var/task bundle was missing .../chromium/bin → "brotli files" error at runtime.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@sparticuz/chromium",
    "playwright-core",
    "playwright",
    "playwright-extra",
    "puppeteer-extra-plugin-stealth",
    "undici",
  ],
  outputFileTracingIncludes: {
    // Match App Router API routes (picomatch). If clicks still miss binaries on deploy,
    // temporarily use "/*" instead of "/api/**" (adds ~60MB to traces).
    "/api/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;

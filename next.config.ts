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
    "/api/**": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      // puppeteer-extra-plugin → merge-deep → clone-deep expects these at runtime; tracing
      // externalized stealth deps can omit nested node_modules on Vercel.
      "./node_modules/is-plain-object/**/*",
      "./node_modules/isobject/**/*",
      "./node_modules/clone-deep/**/*",
      "./node_modules/merge-deep/**/*",
      "./node_modules/puppeteer-extra-plugin/**/*",
      "./node_modules/lazy-cache/**/*",
      "./node_modules/shallow-clone/**/*",
      "./node_modules/kind-of/**/*",
      "./node_modules/for-own/**/*",
      "./node_modules/arr-union/**/*",
      // Stealth loads each evasion via require(); trace must ship the full tree.
      "./node_modules/puppeteer-extra-plugin-stealth/evasions/**/*",
      "./node_modules/puppeteer-extra-plugin-user-preferences/**/*",
    ],
  },
};

export default nextConfig;

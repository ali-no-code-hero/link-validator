This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Link Validator (Supabase + Vercel)

1. Copy [`.env.local.example`](./.env.local.example) to `.env.local` and fill in Collabwork and Supabase keys.
2. In the Supabase SQL editor, run [`supabase/migrations/001_init.sql`](./supabase/migrations/001_init.sql) to create `jobs_fetched` and `click_logs`.
3. For the **Analytics** page ([`/analytics`](./app/analytics/page.tsx)), run [`supabase/migrations/002_analytics_timeseries.sql`](./supabase/migrations/002_analytics_timeseries.sql) so the RPC `link_validator_analytics_timeseries` exists (same SQL editor).
4. For local click tracing, install Chromium for Playwright once: `npx playwright install chromium`.
5. Deploy to Vercel with the same environment variables. The click route sets **`maxDuration` 120s** so slow proxy redirect chains and a navigation retry can finish; ensure your Vercel plan allows it (or lower **`LINK_VALIDATOR_GOTO_TIMEOUT_MS`** / **`LINK_VALIDATOR_GOTO_MAX_ATTEMPTS`** and reduce `maxDuration` in [`app/api/click/[jobId]/route.ts`](./app/api/click/[jobId]/route.ts)). The dashboard processes **one job per serverless invocation** to stay within limits.

### Analytics

Open **`/analytics`** (or use the **Analytics** button on the home dashboard). Charts use **UTC calendar days** for the selected range (7 / 30 / 90 days). Data comes from [`/api/analytics/timeseries`](./app/api/analytics/timeseries/route.ts) via Supabase RPC `link_validator_analytics_timeseries`. The RPC classifies **`final_destination_url`** into: **CollabWORK `app.collabwork.com` + `job=closed`** (closed job landing, e.g. [app.collabwork.com/?job=closed](https://app.collabwork.com/?job=closed)), **any other non-empty URL**, and **no URL** (null/empty). If you deployed analytics before this split existed, re-run the latest [`supabase/migrations/002_analytics_timeseries.sql`](./supabase/migrations/002_analytics_timeseries.sql) in the Supabase SQL editor to replace the function.

### Debugging failed clicks

Server logs emit one JSON object per line with `"component":"link-validator:..."`. On **Vercel**: Project → **Deployments** → a deployment → **Functions** → select `/api/click/[jobId]` → **Logs**, or use the runtime logs stream. Locally they appear in the terminal running `npm run dev`.

- `link-validator:api.click` — job loaded, trace outcome, `failureReason` when marked failed.
- `link-validator:trace` / `trace.goto` — before/after navigation, `response_null` when Playwright returns no `Response` (common cause of `status_code` null and empty HTTP chain).
- `link-validator:playwright.launch` — Chromium launch (Sparticuz on Vercel vs local Playwright).

Set `LINK_VALIDATOR_DEBUG=1` in the environment for full URLs and error stacks in logs.

If Vercel logs show **“The input directory …/node_modules/@sparticuz/chromium/bin does not exist”**, the serverless bundle was missing the brotli binaries. This project sets `outputFileTracingIncludes` in [`next.config.ts`](./next.config.ts) so `next build` copies `node_modules/@sparticuz/chromium/bin` into the function trace. Redeploy after pulling that change.

### Vercel reliability (Playwright + Sparticuz)

The dashboard runs **one job click at a time** (sequential API calls). Parallel runs were causing **`spawn ETXTBSY`** (racing Chromium extraction under `/tmp`) and **`net::ERR_INSUFFICIENT_RESOURCES`**. The server **retries** Chromium launch a few times with backoff, and **retries** `page.goto` once after a short delay if Chrome reports insufficient resources.

### Residential / rotating proxy (optional)

Set **`LINK_VALIDATOR_PROXY_URL`** to a full proxy URL with embedded credentials (same pattern as `request({ proxy: 'http://user:pass@host:port' })`). Example: `http://USERNAME:PASSWORD@proxy.smartproxy.net:3120`. Playwright uses a **realistic desktop Chrome** user agent for navigations. When a proxy is set, each click also runs a **direct vs proxy egress IP** comparison (two lookups) and stores the result in `extra_tracking_data.proxyEgressCheck` so you can confirm the proxy IP differs from the server’s direct egress. The **outbound IP** on the row uses the proxy path via [`undici`](https://undici.nodejs.org/) `ProxyAgent` (default check: ipify JSON). Override the check URL with **`LINK_VALIDATOR_OUTBOUND_IP_URL`** if you use a provider like `https://api.ip.cc`. Never commit real credentials; set the variable in `.env.local` or Vercel **Environment Variables**.

**Anti-bot hardening (technical, not a guarantee):** Chromium launches with **`playwright-extra`** and the **stealth** plugin by default (`LINK_VALIDATOR_STEALTH=0` disables it). Align **`LINK_VALIDATOR_BROWSER_LOCALE`**, **`LINK_VALIDATOR_BROWSER_TIMEZONE`**, and optional **`LINK_VALIDATOR_VIEWPORT_*`** with your proxy’s egress region. For residential proxies, configure **sticky sessions** per your provider (often a session id in the username or URL) so the same IP is used across the redirect chain; see [`.env.local.example`](./.env.local.example). Partner-side allowlists may still be required for heavily protected ATS URLs.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

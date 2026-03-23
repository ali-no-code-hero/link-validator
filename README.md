This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Link Validator (Supabase + Vercel)

1. Copy [`.env.local.example`](./.env.local.example) to `.env.local` and fill in Collabwork and Supabase keys.
2. In the Supabase SQL editor, run [`supabase/migrations/001_init.sql`](./supabase/migrations/001_init.sql) to create `jobs_fetched` and `click_logs`.
3. For local click tracing, install Chromium for Playwright once: `npx playwright install chromium`.
4. Deploy to Vercel with the same environment variables. Set **Function max duration** (e.g. 60s on Pro) to match the click route; the dashboard processes **one job per serverless invocation** to stay within limits.

### Debugging failed clicks

Server logs emit one JSON object per line with `"component":"link-validator:..."`. On **Vercel**: Project → **Deployments** → a deployment → **Functions** → select `/api/click/[jobId]` → **Logs**, or use the runtime logs stream. Locally they appear in the terminal running `npm run dev`.

- `link-validator:api.click` — job loaded, trace outcome, `failureReason` when marked failed.
- `link-validator:trace` / `trace.goto` — before/after navigation, `response_null` when Playwright returns no `Response` (common cause of `status_code` null and empty HTTP chain).
- `link-validator:playwright.launch` — Chromium launch (Sparticuz on Vercel vs local Playwright).

Set `LINK_VALIDATOR_DEBUG=1` in the environment for full URLs and error stacks in logs.

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

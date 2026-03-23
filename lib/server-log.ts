/**
 * Structured logs for API routes / Playwright (stdout → Vercel / local terminal).
 * Set LINK_VALIDATOR_DEBUG=1 for full URLs and extra fields.
 */

const DEBUG = process.env.LINK_VALIDATOR_DEBUG === "1";

export function truncateUrl(url: string, max = 140): string {
  if (DEBUG) {
    return url;
  }
  if (url.length <= max) {
    return url;
  }
  return `${url.slice(0, max - 1)}…`;
}

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, component: string, message: string, meta?: Record<string, unknown>) {
  const line = {
    level,
    component: `link-validator:${component}`,
    message,
    ts: new Date().toISOString(),
    ...meta,
  };
  const text = JSON.stringify(line);
  if (level === "error") {
    console.error(text);
  } else if (level === "warn") {
    console.warn(text);
  } else {
    console.log(text);
  }
}

export function logInfo(component: string, message: string, meta?: Record<string, unknown>) {
  emit("info", component, message, meta);
}

export function logWarn(component: string, message: string, meta?: Record<string, unknown>) {
  emit("warn", component, message, meta);
}

export function logError(
  component: string,
  message: string,
  err: unknown,
  meta?: Record<string, unknown>,
) {
  const errMessage = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  emit("error", component, message, {
    ...meta,
    errMessage,
    ...(DEBUG && stack ? { stack } : {}),
  });
}

export function runtimeHints(): Record<string, unknown> {
  return {
    vercel: Boolean(process.env.VERCEL),
    nodeEnv: process.env.NODE_ENV,
    region: process.env.VERCEL_REGION,
  };
}

// Captures an error briefly so server.ts can recognize h3's generic 500 response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "Application error (details omitted).";
  const name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : "Error";
  const { status, statusCode } = error as Error & { status?: unknown; statusCode?: unknown };
  const code = status ?? statusCode;
  const statusLabel = typeof code === "number" && Number.isFinite(code) ? ` status=${code}` : "";
  return `Application error type=${name}${statusLabel}; details omitted.`;
}

// Wrap console.error so errors logged by any layer — including h3's internal
// unhandled-error logging, which this file cannot hook directly — are recorded
// for consumeLastCapturedError. Never log messages, stacks, causes, or objects;
// providers and database drivers may include keys or submitted text in them.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const sanitized = args.map((arg) => {
    if (arg instanceof Error) {
      record(arg);
      return describeError(arg);
    }
    if (arg === null || typeof arg === "number" || typeof arg === "boolean") return arg;
    return "[redacted log detail]";
  });
  originalConsoleError(...sanitized);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

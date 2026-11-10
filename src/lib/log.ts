/**
 * The Worker's structured logger: one JSON line per event (Workers Logs / observability index the
 * fields). New code logs through this instead of console.* directly.
 */
type Fields = Record<string, unknown>;

function line(level: "info" | "warn" | "error", msg: string, fields?: Fields): string {
   return JSON.stringify({ level, msg, ...(fields ?? {}) });
}

export const log = {
   info: (msg: string, fields?: Fields) => console.log(line("info", msg, fields)),
   warn: (msg: string, fields?: Fields) => console.warn(line("warn", msg, fields)),
   error: (msg: string, fields?: Fields) => console.error(line("error", msg, fields)),
};

/** An error as a short loggable string (never a stack with request data). */
export const errText = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);

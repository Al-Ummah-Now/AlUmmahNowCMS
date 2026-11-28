/**
 * The Worker's structured logger: one JSON line per event (Workers Logs / observability index the
 * fields). New code logs through this instead of console.* directly.
 */
type Fields = Record<string, unknown>;

const LOG_CTRL = /[\r\n\u0000-\u001f\u007f]+/g;

/** Strips CR/LF and ASCII control chars so untrusted text cannot forge log lines or inject terminal escapes. */
export const sanitizeLogText = (text: string, max = 500): string => text.replace(LOG_CTRL, " ").trim().slice(0, max);

function line(level: "info" | "warn" | "error", msg: string, fields?: Fields): string {
   return JSON.stringify({ level, msg: sanitizeLogText(msg, 300), ...(fields ?? {}) });
}

export const log = {
   info: (msg: string, fields?: Fields) => console.log(line("info", msg, fields)),
   warn: (msg: string, fields?: Fields) => console.warn(line("warn", msg, fields)),
   error: (msg: string, fields?: Fields) => console.error(line("error", msg, fields)),
};

/** An error as a short loggable string (never a stack with request data, never raw control chars). */
export const errText = (error: unknown): string => sanitizeLogText(error instanceof Error ? `${error.name}: ${error.message}` : String(error), 500);

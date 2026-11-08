/** Parses JSON with comments and trailing commas (wrangler.jsonc). Strings are left intact. */
export function parseJsonc<T = unknown>(text: string): T {
   let out = "";
   let i = 0;
   let inString = false;
   while (i < text.length) {
      const ch = text[i];
      const next = text[i + 1];
      if (inString) {
         out += ch;
         if (ch === "\\") {
            out += next ?? "";
            i += 2;
            continue;
         }
         if (ch === '"') inString = false;
         i++;
      } else if (ch === '"') {
         inString = true;
         out += ch;
         i++;
      } else if (ch === "/" && next === "/") {
         while (i < text.length && text[i] !== "\n") i++;
      } else if (ch === "/" && next === "*") {
         i += 2;
         while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
         i += 2;
      } else {
         out += ch;
         i++;
      }
   }
   return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as T;
}

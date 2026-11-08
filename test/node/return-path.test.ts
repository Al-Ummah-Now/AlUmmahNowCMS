import { describe, expect, it } from "vitest";
import { safeReturnPath } from "../../src/lib/return-path.ts";

describe("safeReturnPath", () => {
   it.each([
      ["/", "/"],
      ["/data/entity/posts", "/data/entity/posts"],
      ["/picker?lang=ar#x", "/picker?lang=ar#x"],
   ])("keeps same-origin path %s", (input, out) => expect(safeReturnPath(input)).toBe(out));

   it.each([
      [null],
      [undefined],
      [""],
      ["https://evil.example/"],
      ["//evil.example/x"],
      ["/\\evil.example"],
      ["\\\\evil.example"],
      ["javascript:alert(1)"],
      ["data:text/html,hi"],
      ["/%0d%0aSet-Cookie:x"],
      ["/\u0000x"],
      ["/\tx"],
      ["evil.example"],
      ["/sso/login?return=/"],
      ["/sso/callback"],
      ["/" + "a".repeat(3000)],
   ])("rejects %s", (input) => {
      const out = safeReturnPath(input as string | null | undefined);
      expect(out === "/" || (out.startsWith("/") && !out.startsWith("//"))).toBe(true);
      if (input && input !== "/%0d%0aSet-Cookie:x") expect(out).toBe("/");
   });

   it("keeps encoded CR/LF encoded (never decoded into a header)", () => {
      expect(safeReturnPath("/%0d%0aSet-Cookie:x")).toBe("/%0d%0aSet-Cookie:x");
   });
});

import { expect, it } from "vitest";
import { renderMarkdownInto } from "../../src/admin/client/markdown.ts";
import { citedQuotation } from "../../src/lib/qaf/model.ts";
import { QAF_MARKUP, QAF_PASSAGE } from "../support/qaf-mock.ts";

it("renders a cited Qaf quotation as literal text even with markup, Markdown and fence delimiters", () => {
   const raw = citedQuotation({ ...QAF_PASSAGE, text: QAF_MARKUP }, "en")!;
   const preview = document.createElement("div");
   renderMarkdownInto(preview, raw, "Video");
   expect(preview.querySelector("script,img,[onerror],a")).toBeNull();
   expect(preview.querySelector("blockquote")?.getAttribute("dir")).toBe("rtl");
   expect(preview.querySelector("blockquote")?.textContent).toBe(QAF_MARKUP);
});

import type { Passage } from "../../src/lib/qaf/model.ts";

export const FAKE_QAF_KEY = "qaf_sk_" + "localFixture";
export const FAKE_QAF_BLOCKED_KEY = "qaf_sk_" + "blockedFixture";
export const QAF_PASSAGE: Passage = {
   id: "d9335f69-e54b-59ae-a78c-50db734b8d50",
   text: "وَالصَّبْرُ عِنْدَ الصَّدْمَةِ الأُولَى.\n\nفتأمَّلْ  هذا الموضعَ.",
   url: "https://qaf.ai/passages/d9335f69-e54b-59ae-a78c-50db734b8d50",
   turathUrl: "https://app.turath.io/book/21660?print_page=4%2C233",
   pages: [{ vol: "4", page: 1234 }, { vol: "4", page: 1235 }],
   book: { title: "Fayd al-Qadir", titleArabic: "فيض القدير" },
   author: { name: "Abd al-Rauf al-Munawi", nameArabic: "عبد الرؤوف المناوي" },
};
export const QAF_BOOK_ID = "31f522f9-b85c-5c78-a8ff-dc48ebce183c";
export const QAF_MARKUP = "<script>globalThis.qafXss = true</script>\n<img src=x onerror='globalThis.qafXss = true'>\n~~~\n![remote](https://example.test/image)";
export const QAF_INJECTED_NAME = "اسم ](javascript:alert(1)) <img src=x onerror=alert(1)>";
export const QAF_AI_QUERY = "الصبر عند المصيبة";

export function fakeQaf() {
   const requests: { url: URL; body: Record<string, unknown> | null }[] = [];
   return {
      requests,
      fetch(url: URL, token: string | null, body: Record<string, unknown> | null) {
         requests.push({ url, body });
         const headers = { "X-Request-Id": `fake-qaf-${requests.length}`, "X-RateLimit-Remaining": "13" };
         const send = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
         const error = (status: number, code: string, reason?: string, retryAfter?: string) => send(
            { code, status, message: "Private upstream error", data: { reason } },
            status,
            retryAfter ? { "Retry-After": retryAfter } : {},
         );
         if (token === `Bearer ${FAKE_QAF_BLOCKED_KEY}`) return error(429, "RATE_LIMITED", "invalid_keys", "12");
         if (token !== `Bearer ${FAKE_QAF_KEY}`) return error(401, "UNAUTHORIZED");
         if (url.pathname.endsWith("/search")) {
            const query = String(body?.query);
            const count = requests.filter((r) => r.body?.query === query).length;
            if (query.startsWith("fixture-422")) return error(422, "INPUT_VALIDATION_FAILED");
            if (query.startsWith("fixture-minute") && count === 1) return error(429, "RATE_LIMITED", "minute", "1");
            if (query.startsWith("fixture-minute-always")) return error(429, "RATE_LIMITED", "minute", "1");
            if (query.startsWith("fixture-week")) return error(429, "RATE_LIMITED", "week", "604800");
            if (query.startsWith("fixture-503") && count < 3) return error(503, "SERVICE_UNAVAILABLE");
            if (query.startsWith("fixture-xss")) {
               const injected = { ...QAF_PASSAGE, text: QAF_MARKUP, book: { title: QAF_INJECTED_NAME, titleArabic: QAF_INJECTED_NAME } };
               return send({ results: [injected, { ...injected, url: "javascript:alert(1)", turathUrl: "data:text/html,bad" }] });
            }
            return send({ results: [QAF_PASSAGE] });
         }
         if (url.pathname.endsWith("/catalog/lookup")) {
            const ar = url.searchParams.get("locale") === "ar";
            const author = ar ? QAF_PASSAGE.author.nameArabic : QAF_PASSAGE.author.name;
            const book = ar ? QAF_PASSAGE.book.titleArabic : QAF_PASSAGE.book.title;
            const candidate = url.searchParams.get("type") === "author"
               ? { type: "author", id: 423, label: author }
               : { type: "book", id: QAF_BOOK_ID, label: book, authorLabel: author };
            return send({ candidates: [{ ...candidate, deathYearAH: 1031, deathInexactLabel: null }] });
         }
         if (url.pathname.endsWith(`/passages/${QAF_PASSAGE.id}`)) {
            return send({
               ...QAF_PASSAGE, footnotes: "حاشية الطبعة.",
               before: [{ ...QAF_PASSAGE, text: "السياق السابق." }],
               after: [{ ...QAF_PASSAGE, text: "السياق اللاحق." }],
            });
         }
         return error(404, "NOT_FOUND");
      },
   };
}

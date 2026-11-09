/**
 * Preview renderer for the body editor. Escapes everything first, then applies a small markdown
 * subset (headings, bold, italic, links, lists, quotes, paragraphs) and shows `::video[ID]` lines
 * as a video card, matching www's rule (AlUmmahNowUI src/lib/markdown.ts: the line on its own).
 */
export const VIDEO_LINE = /^::video\[([^\]\n]{1,80})\]\s*$/;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
   return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(((?:https:\/\/|\/)[^\s)]*)\)/g, (_m, text: string, href: string) => `<a href="${href}" rel="noopener">${text}</a>`);
}

export function renderMarkdown(src: string, videoLabel: string): string {
   const out: string[] = [];
   let para: string[] = [];
   let list: string[] = [];
   const flush = () => {
      if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`);
      para = [];
      list = [];
   };
   for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
      const video = VIDEO_LINE.exec(line);
      if (video) {
         flush();
         out.push(`<div class="md-video"><span aria-hidden="true">▶</span> ${esc(videoLabel)}: <code>${esc(video[1])}</code></div>`);
         continue;
      }
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
         flush();
         const level = Math.min(h[1].length + 1, 4);
         out.push(`<h${level}>${inline(h[2])}</h${level}>`);
         continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
         if (para.length) flush();
         list.push(line.replace(/^\s*[-*]\s+/, ""));
         continue;
      }
      if (/^>\s?/.test(line)) {
         flush();
         out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
         continue;
      }
      if (!line.trim()) {
         flush();
         continue;
      }
      if (list.length) flush();
      para.push(line);
   }
   flush();
   return out.join("\n");
}

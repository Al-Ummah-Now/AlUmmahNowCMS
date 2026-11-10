/**
 * Preview renderer for the body editor. Builds DOM nodes (text is never parsed as HTML) for a
 * small markdown subset — headings, bold, italic, links, lists, quotes, paragraphs — and shows
 * `::video[ID]` lines as a video card, matching www's rule (AlUmmahNowUI src/lib/markdown.ts).
 */
export const VIDEO_LINE = /^::video\[([^\]\n]{1,80})\]\s*$/;
const INLINE = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(((?:https:\/\/|\/(?!\/))[^\s)]*)\)/g;

function inline(parent: Node, text: string): void {
   let last = 0;
   for (const m of text.matchAll(INLINE)) {
      const at = m.index ?? 0;
      if (at > last) parent.appendChild(document.createTextNode(text.slice(last, at)));
      if (m[1] !== undefined) parent.appendChild(document.createElement("strong")).textContent = m[1];
      else if (m[2] !== undefined) parent.appendChild(document.createElement("em")).textContent = m[2];
      else {
         // A preview needs no live link: show the text styled as a link, the address beside it.
         const a = parent.appendChild(document.createElement("span"));
         a.className = "md-link";
         a.textContent = m[3];
         parent.appendChild(document.createElement("small")).textContent = ` (${m[4]})`;
      }
      last = at + m[0].length;
   }
   if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

export function renderMarkdownInto(target: HTMLElement, src: string, videoLabel: string): void {
   target.replaceChildren();
   let para: string[] = [];
   let list: string[] = [];
   const flush = () => {
      if (para.length) {
         const p = target.appendChild(document.createElement("p"));
         para.forEach((line, i) => {
            if (i) p.appendChild(document.createElement("br"));
            inline(p, line);
         });
      }
      if (list.length) {
         const ul = target.appendChild(document.createElement("ul"));
         for (const item of list) inline(ul.appendChild(document.createElement("li")), item);
      }
      para = [];
      list = [];
   };
   for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
      const video = VIDEO_LINE.exec(line);
      if (video) {
         flush();
         const card = target.appendChild(document.createElement("div"));
         card.className = "md-video";
         card.append("▶ ", `${videoLabel}: `);
         card.appendChild(document.createElement("code")).textContent = video[1];
         continue;
      }
      const h = /^(#{1,3}) (.*)$/.exec(line);
      if (h) {
         flush();
         inline(target.appendChild(document.createElement(`h${Math.min(h[1].length + 1, 4)}`)), h[2]);
         continue;
      }
      const li = /^ {0,3}[-*] (.*)$/.exec(line);
      if (li) {
         if (para.length) flush();
         list.push(li[1]);
         continue;
      }
      if (line.startsWith(">")) {
         flush();
         inline(target.appendChild(document.createElement("blockquote")), line.replace(/^> ?/, ""));
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
}

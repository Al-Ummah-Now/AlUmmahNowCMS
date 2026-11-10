/**
 * A small accessible combobox: an input with a filtered list of suggestions (ARIA 1.2 pattern:
 * role=combobox + listbox, aria-activedescendant, arrows / Enter / Escape). Typing anything is still
 * allowed; the list only helps pick a known value. Markup: `<div class="combo"><input role="combobox">
 * <ul class="combo-list" role="listbox" hidden></ul></div>`.
 */
let seq = 0;

/** Case-insensitive "contains" filter, exact matches first, at most `max`. */
export function filterOptions(options: string[], typed: string, max = 50): string[] {
   const q = typed.trim().toLowerCase();
   const uniq = [...new Set(options.filter(Boolean))];
   if (!q) return uniq.slice(0, max);
   const hits = uniq.filter((o) => o.toLowerCase().includes(q));
   return hits.sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q))).slice(0, max);
}

export function attachCombobox(input: HTMLInputElement, options: () => string[], emptyText: () => string = () => ""): void {
   const list = input.parentElement?.querySelector<HTMLUListElement>(".combo-list");
   if (!list || input.dataset.comboReady) return;
   input.dataset.comboReady = "1";
   const id = `combo-${++seq}`;
   list.id = id;
   input.setAttribute("aria-controls", id);
   let items: HTMLLIElement[] = [];
   let active = -1;

   const close = () => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
   };
   const mark = (i: number) => {
      active = i;
      items.forEach((li, n) => li.setAttribute("aria-selected", String(n === i)));
      if (i >= 0 && items[i]) {
         input.setAttribute("aria-activedescendant", items[i].id);
         items[i].scrollIntoView({ block: "nearest" });
      } else input.removeAttribute("aria-activedescendant");
   };
   const choose = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close();
   };
   const open = () => {
      const found = filterOptions(options(), input.value);
      // Nothing left to choose: the value already is the one suggestion (don't cover what's below).
      if (found.length === 1 && found[0] === input.value.trim()) return close();
      list.replaceChildren();
      items = found.map((o, n) => {
         const li = document.createElement("li");
         li.id = `${id}-${n}`;
         li.setAttribute("role", "option");
         li.setAttribute("aria-selected", "false");
         li.textContent = o;
         li.addEventListener("mousedown", (e) => e.preventDefault());
         li.addEventListener("click", () => choose(o));
         return li;
      });
      if (items.length === 0) {
         const text = emptyText();
         if (!text) return close();
         const li = document.createElement("li");
         li.className = "combo-empty";
         li.textContent = text;
         list.append(li);
      } else list.append(...items);
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      active = -1;
   };

   input.addEventListener("focus", open);
   input.addEventListener("input", (e) => {
      if (e.isTrusted) open();
   });
   input.addEventListener("blur", close);
   input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
         e.preventDefault();
         if (list.hidden) open();
         if (!items.length) return;
         const next = e.key === "ArrowDown" ? (active + 1) % items.length : (active - 1 + items.length) % items.length;
         mark(next);
      } else if (e.key === "Enter" && !list.hidden && active >= 0) {
         e.preventDefault();
         choose(items[active].textContent ?? "");
      } else if (e.key === "Escape" && !list.hidden) {
         e.preventDefault();
         close();
      }
   });
}

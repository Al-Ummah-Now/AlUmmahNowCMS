import { describe, expect, it } from "vitest";
import { announcement, failed, initialState, keyDown, MIN_QUERY, optionsFor, received, typed, type State, type Suggestion } from "../../src/admin/client/autocomplete-model.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

const s = (id: string, label: string): Suggestion => ({ kind: "posts", id, label, secondary: "Post · Published", imageUrl: null, href: `/posts/${id}` });
const ITEMS = [s("1", "Ramadan"), s("2", "Ramadan timetable")];
const ready = (q = "rama", items = ITEMS): State => received(typed(initialState(), q), q, items);
const press = (state: State, ...keys: string[]) => keys.reduce((r, k) => keyDown(r.state, k), { state, effect: { type: "none" }, preventDefault: false } as ReturnType<typeof keyDown>);

describe("search suggestions: model (same behaviour as the videos admin)", () => {
   it("asks from two characters and drops answers for an older query", () => {
      expect(MIN_QUERY).toBe(2);
      expect(typed(initialState(), "r")).toMatchObject({ open: false, status: "idle" });
      const waiting = typed(initialState(), "ramadan");
      expect(waiting).toMatchObject({ open: true, status: "loading", active: -1 });
      expect(received(waiting, "rama", ITEMS)).toBe(waiting);
      expect(failed(waiting, "rama")).toBe(waiting);
   });

   it("always ends with 'search everything', also when suggestions fail", () => {
      expect(optionsFor("rama", ITEMS).map((o) => o.type)).toEqual(["suggestion", "suggestion", "searchAll"]);
      expect(failed(typed(initialState(), "rama"), "rama")).toMatchObject({ status: "error", options: [{ type: "searchAll", query: "rama" }] });
   });

   it("Down/Up move and wrap, Alt+Up closes, Enter chooses the active option", () => {
      expect(press(ready(), "ArrowDown").state.active).toBe(0);
      expect(press(ready(), "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown").state.active).toBe(0);
      expect(press(ready(), "ArrowUp").state.active).toBe(2);
      expect(keyDown(press(ready(), "ArrowDown").state, "ArrowUp", true).state).toMatchObject({ open: false, active: -1 });
      const r = press(ready(), "ArrowDown", "ArrowDown", "Enter");
      expect(r.effect).toEqual({ type: "choose", option: { type: "suggestion", suggestion: ITEMS[1] } });
      expect(r.preventDefault).toBe(true);
   });

   it("Enter with nothing active submits the form (the full search)", () => {
      expect(press(ready(), "Enter")).toMatchObject({ effect: { type: "default" }, preventDefault: false });
   });

   it("Escape closes, then clears; Tab closes; other keys stay with the input", () => {
      const once = keyDown(ready(), "Escape");
      expect(once.state).toMatchObject({ open: false, query: "rama" });
      expect(keyDown(once.state, "Escape")).toMatchObject({ effect: { type: "clear" }, state: { query: "" } });
      expect(keyDown(ready(), "Tab")).toMatchObject({ state: { open: false }, preventDefault: false });
      for (const k of ["a", "Home", "End"]) expect(keyDown(ready(), k).preventDefault).toBe(false);
   });

   it("announces the count, nothing found, a failure and the wait, in both languages", () => {
      for (const lang of ["en", "ar"] as const) {
         const t = ADMIN_STRINGS[lang].autocomplete;
         const T = { searching: t.searching, failed: t.failed, none: t.none, count: t.count };
         expect(announcement(ready(), T)).toBe(t.count.replace("{0}", "2"));
         expect(announcement(ready("zzzz", []), T)).toBe(t.none);
         expect(announcement(typed(initialState(), "rama"), T)).toBe(t.searching);
         expect(announcement(failed(typed(initialState(), "rama"), "rama"), T)).toBe(t.failed);
         expect(announcement(initialState(), T)).toBe("");
      }
      expect(ADMIN_STRINGS.ar.autocomplete.searchAll).toMatch(/[؀-ۿ]/);
   });
});

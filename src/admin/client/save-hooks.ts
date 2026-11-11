/**
 * Work that must happen only once the editor's save succeeded, before the page reloads (e.g. translation
 * flags resolved by an edit: src/admin/client/translation-flags.ts). A failing hook never undoes the save;
 * it is reported by the hook itself.
 */
type Hook = (rowId: string) => Promise<void>;

const hooks: Hook[] = [];

export function addSaveHook(hook: Hook): void {
   hooks.push(hook);
}

export async function runSaveHooks(rowId: string): Promise<void> {
   for (const h of hooks) {
      try {
         await h(rowId);
      } catch {
         // The save itself succeeded; the hook shows its own error.
      }
   }
}

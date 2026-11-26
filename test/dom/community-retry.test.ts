import { afterEach, expect, it, vi } from "vitest";
import { initScholars } from "../../src/admin/client/scholars.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

afterEach(() => {
   document.body.replaceChildren();
   vi.unstubAllGlobals();
   vi.clearAllTimers();
   vi.useRealTimers();
});

it.each(["en", "ar"] as const)("retries community posts from the Overview in %s", async (lang) => {
   vi.useFakeTimers();
   const { featuring, common } = ADMIN_STRINGS[lang];
   document.body.innerHTML = '<div id="toasts"></div><section data-community-flag><button data-community-retry></button></section>';
   const button = document.querySelector<HTMLButtonElement>("[data-community-retry]")!;
   button.dataset.done = featuring.communityRetried;
   button.dataset.failed = common.failed;
   const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "internal_error" }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ data: { requeued: 3 } }));
   vi.stubGlobal("fetch", request);
   initScholars();

   button.click();
   expect(button.disabled).toBe(true);
   await vi.waitFor(() => expect(button.disabled).toBe(false));
   expect(document.querySelector("[data-community-flag]")).not.toBeNull();
   expect(document.querySelector(".toast.bad")?.textContent).toContain(common.failed);

   button.click();
   await vi.waitFor(() => expect(document.querySelector("[data-community-flag]")).toBeNull());
   expect(request).toHaveBeenCalledTimes(2);
   expect(request).toHaveBeenLastCalledWith("/admin/api/featuring/community/retry", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
   expect(document.querySelector(".toast.ok")?.textContent).toContain(featuring.communityRetried);
});

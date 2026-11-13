import { describe, expect, it } from "vitest";
import { mapRoles, normalizeRole } from "../../src/lib/roles.ts";

describe("normalizeRole", () => {
   it.each([
      ["Super Admin", "super_admin"],
      ["  super-admin ", "super_admin"],
      ["ADMIN", "admin"],
      ["Moderator", "moderator"],
      ["Content  Editor", "content_editor"],
   ])("%s → %s", (input, out) => expect(normalizeRole(input)).toBe(out));
});

describe("mapRoles", () => {
   it("maps super_admin and admin to bknd admin", () => {
      expect(mapRoles(["Super Admin"])).toBe("admin");
      expect(mapRoles(["Admin"])).toBe("admin");
   });
   it("maps moderator to bknd editor", () => expect(mapRoles(["Moderator"])).toBe("editor"));
   it("maps scholar to bknd writer (Write in Studio, SS18)", () => expect(mapRoles(["Scholar", "Member"])).toBe("writer"));
   it("maps writer (staff) to bknd staff_writer (Al Ummah Now's own posts)", () => expect(mapRoles(["Writer"])).toBe("staff_writer"));
   it("a staff writer who is also a scholar is a staff writer; an editor outranks both", () => {
      expect(mapRoles(["Scholar", "Writer"])).toBe("staff_writer");
      expect(mapRoles(["Writer", "Moderator"])).toBe("editor");
   });
   it("takes the strongest role", () => {
      expect(mapRoles(["Moderator", "Viewer", "Admin"])).toBe("admin");
      expect(mapRoles(["Scholar", "Moderator"])).toBe("editor");
      expect(mapRoles(["Moderator", "Scholar"])).toBe("editor");
      expect(mapRoles(["Scholar", "Super Admin"])).toBe("admin");
   });
   it("denies everyone else", () => {
      expect(mapRoles(["Viewer"])).toBeNull();
      expect(mapRoles(["Content Editor"])).toBeNull();
      expect(mapRoles([])).toBeNull();
      expect(mapRoles(undefined)).toBeNull();
      expect(mapRoles("Admin")).toBeNull();
      expect(mapRoles([42, null, { name: "Admin" }])).toBeNull();
   });
   it("does not accept look-alikes", () => {
      expect(mapRoles(["administrator"])).toBeNull();
      expect(mapRoles(["admin_viewer"])).toBeNull();
   });
});

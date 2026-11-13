/**
 * Which staff screens and Worker endpoints a writer (auth "Scholar") may open (docs/SCHOLARS.md §2).
 * Everything else answers 403 for them. Scholars write in Studio (§7, SS18): the CMS gives them
 * "Write in Studio" and their profile; their old post screens redirect there.
 */
const WRITER_PATHS: RegExp[] = [
   /^\/$/,
   /^\/write\/?$/,
   // Old bookmarks: /posts… redirect to /write
   /^\/posts(\/.*)?$/,
   /^\/scholars\/me\/?$/,
   /^\/admin\/api\/scholars\/me(\/.*)?$/,
   /^\/admin\/api\/suggest\/?$/,
   /^\/admin\/api\/media\/\d{1,12}\/alt\/?$/,
];

/** Pure; unit-tested. Per-method rules live in the routes themselves. */
export function writerScreenAllowed(_method: string, path: string): boolean {
   return WRITER_PATHS.some((re) => re.test(path));
}

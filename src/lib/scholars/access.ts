/**
 * Which staff screens and Worker endpoints a writer (auth "Scholar") may open (docs/SCHOLARS.md §2).
 * Everything else answers 403 for them. Ownership of a single post is checked by each route.
 */
const WRITER_PATHS: RegExp[] = [
   /^\/$/,
   /^\/posts\/?$/,
   /^\/posts\/new\/?$/,
   /^\/posts\/\d{1,12}\/?$/,
   /^\/posts\/\d{1,12}\/history\/?$/,
   /^\/scholars\/me\/?$/,
   /^\/admin\/api\/scholars\/me(\/.*)?$/,
   /^\/admin\/api\/suggest\/?$/,
   /^\/admin\/api\/ai(\/.*)?$/,
   /^\/admin\/api\/revisions\/\d{1,12}\/restore\/?$/,
   /^\/admin\/api\/media\/\d{1,12}\/alt\/?$/,
   /^\/picker\/api\/.+$/,
   /^\/preview\/posts\/\d{1,12}\/?$/,
];

/** Pure; unit-tested. Per-method rules live in the routes themselves. */
export function writerScreenAllowed(_method: string, path: string): boolean {
   return WRITER_PATHS.some((re) => re.test(path));
}

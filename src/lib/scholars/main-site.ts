/**
 * What is on the main site (docs/SCHOLARS.md §5): every staff post (no author_sub), and a scholar's
 * post only once an editor featured it. Applies to the home timeline, the Articles list, the home
 * page's latest posts, card post lists and "latest / by tag" post blocks. A scholar post that is not
 * featured is still live at its own address, on its scholar's page, in search, in the sitemap and in
 * its channel's community.
 */
export const MAIN_SITE_SQL = "(author_sub IS NULL OR featured_at IS NOT NULL)";

/** MAIN_SITE_SQL for a query that names the posts table `alias`. */
export const mainSiteSql = (alias: string) => `(${alias}.author_sub IS NULL OR ${alias}.featured_at IS NOT NULL)`;

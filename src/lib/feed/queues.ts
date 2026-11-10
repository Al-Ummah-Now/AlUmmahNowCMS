/** Queue names of the home timeline builds (wrangler.jsonc): al-ummah-now-cms-feed[-stage|-qa] and the DLQ. */
export const isFeedQueue = (name: string) => /^al-ummah-now-cms-feed(-stage|-qa)?$/.test(name);
export const isFeedDlq = (name: string) => /^al-ummah-now-cms-feed-dlq(-stage|-qa)?$/.test(name);

// The /api/* routes are dynamic server endpoints that run on the Node runtime
// (adapter-node) — never prerendered. This declares that intent at the group
// level. Note: per the SvelteKit docs, `+server.js` files are NOT affected by
// layouts, so each +server.ts must still export its own `prerender = false`.
export const prerender = false;

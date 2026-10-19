import { z } from 'zod';

/**
 * Zod v4 compiles object parsers with `new Function` when it can, and probes for that by
 * calling `Function('')` the first time a schema is built. The Content-Security-Policy
 * (svelte.config.js `kit.csp`) forbids eval, so the probe fails — harmlessly, zod falls
 * back to its interpreter — but logs a CSP violation on every page. Opt out up front.
 * Client hooks load before any route module, so this runs before the first schema.
 */
z.config({ jitless: true });

/**
 * Server-safe entry point for the consent feature.
 *
 * Everything exported here is pure (Zod schemas, policy, VDU source), so `+server.ts` files,
 * `$lib/server/*` and Node scripts import it instead of the feature barrel, which will also
 * carry Svelte components.
 */
export * from './domain/consent';
export { CONSENT_COPY, CONSENT_NOTICE_VERSION } from './domain/consent-notice.i18n';

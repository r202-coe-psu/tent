/**
 * Typed OpenAPI client for FastAPI public paths — **server / tooling only**.
 * Browser traffic must use same-origin BFF `/api/public/v1/*` (CR-063).
 * Do not set `baseUrl: '/public-api'` for SPA calls.
 */
import createClient from 'openapi-fetch';
import type { paths } from './openapi';

export const publicClient = createClient<paths>({ baseUrl: '/api' });

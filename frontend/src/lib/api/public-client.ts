/**
 * Typed OpenAPI client for the public plane.
 * Browser calls `/public-api` + OpenAPI paths (`/public/v1/*`).
 * Same-origin: Vite proxy in dev, nginx in prod/staging.
 * Not used for staff `/api/v1/*` (see `service.ts`).
 */
import createClient from 'openapi-fetch';
import type { paths } from './openapi';

export const publicClient = createClient<paths>({ baseUrl: '/public-api' });

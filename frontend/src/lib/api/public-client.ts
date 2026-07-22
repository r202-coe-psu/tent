/**
 * Typed OpenAPI client for the public plane (`/public/v1/*` → FastAPI).
 * Same-origin via Vite proxy in dev; reverse proxy in prod.
 * Not used for staff `/api/v1/*` (see `service.ts`).
 */
import createClient from 'openapi-fetch';
import type { paths } from './openapi';

export const publicClient = createClient<paths>({ baseUrl: '' });

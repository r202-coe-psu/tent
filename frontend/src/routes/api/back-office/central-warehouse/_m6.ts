import { json } from '@sveltejs/kit';
import { IntegrationError } from '$lib/server/integrations';
import { handleEndpointError } from './_auth';

/** `{ error, code, …extra }` for M6 / integration failures; anything else as the other routes do. */
export function m6ErrorResponse(e: unknown, label: string) {
	if (e instanceof IntegrationError) {
		return json(
			{ error: e.message, code: e.code, ...e.extra },
			{ status: e.status, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	return handleEndpointError(e, label);
}

/** Every central-warehouse answer is live data — never cached by the browser or a proxy. */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Plain code FastAPI accepts as a path param (`^[A-Za-z0-9._-]{1,64}$`); dot-only segments are refused. */
const CODE_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const CODE_PATTERN = {
	test: (code: string): boolean => CODE_RE.test(code) && !/^\.+$/.test(code)
};

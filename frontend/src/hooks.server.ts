import { building } from '$app/environment';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { startPrintHousekeeping } from '$lib/server/printers/lazy-sweep';
import { printingDbExists, printJobStore } from '$lib/server/printers/printer-server';

/** Print-job housekeeping must not depend on a Pi polling (plan §3.5, PDPA). */
export const init: ServerInit = () => {
	if (!building) startPrintHousekeeping(printJobStore, { isProvisioned: printingDbExists });
};

/** First-party pages may request GPS; public distance filter depends on it. */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('Permissions-Policy', 'geolocation=(self)');
	return response;
};

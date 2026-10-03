import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	clearPendingLinkCookie,
	pendingLinkDisplay,
	readPendingLink
} from '$lib/server/pending-link';

export const prerender = false;

/** GET — which OAuth identity is waiting to be linked (never the raw `sub`); 401 when none. */
export const GET: RequestHandler = async ({ cookies }) => {
	const link = readPendingLink(cookies);
	if (!link) {
		return json(
			{ error: { code: 'LINK_EXPIRED', message: 'No pending link' } },
			{ status: 401, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	return json(
		{ provider: link.provider, display: pendingLinkDisplay(link) },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};

/** DELETE — cancel link-on-first-login. */
export const DELETE: RequestHandler = async ({ cookies }) => {
	clearPendingLinkCookie(cookies);
	return json({ ok: true });
};

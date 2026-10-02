import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createScanSession } from '$lib/server/thaid-scan-session';

export const prerender = false;

/**
 * POST /api/public/v1/thaid/scan-session
 * Creates a temporary cross-device scan session for adding a household member.
 */
export const POST: RequestHandler = async ({ url }) => {
	const ttlSeconds = 900; // 15 minutes TTL
	const session = createScanSession(ttlSeconds);
	const qrUrl = `${url.origin}/api/v1/auth/oauth/thaid/start?mode=member_scan&session_id=${session.id}`;

	return json(
		{
			sessionId: session.id,
			qrUrl,
			expiresAt: session.expiresAt,
			ttlSeconds
		},
		{
			headers: {
				'Cache-Control': 'no-store'
			}
		}
	);
};

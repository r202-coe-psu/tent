import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getScanSession } from '$lib/server/thaid-scan-session';

export const prerender = false;

/**
 * GET /api/public/v1/thaid/scan-session/[id]
 * Checks the current status of a scan session (used as a polling fallback).
 */
export const GET: RequestHandler = async ({ params }) => {
	const session = getScanSession(params.id);
	// Kiosk sessions are private to their device (FR-KTD-06): answer as if missing.
	if (!session || session.kind !== 'member_scan') {
		return json({ status: 'expired' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
	}

	return json(
		{
			id: session.id,
			status: session.status,
			profile: session.profile ?? null,
			expiresAt: session.expiresAt
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireShelterManagerOrSA, serviceError } from '$lib/server/couch-admin';
import { applyZoneTransition } from '$lib/server/shelter-zones';

export const prerender = false;

const closeZoneSchema = z.object({
	reason: z.string().trim().optional().nullable()
});

/**
 * POST /api/back-office/shelter/{code}/zones/{zoneCode}
 * Body: { reason?: string }
 * - close: set status='closed', record closed_at/closed_by/reason, append audit log
 *   Returns 409 if the zone is already closed.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	const zoneCode = params.zoneCode;
	if (!code || !zoneCode) return error(400, { message: 'Missing code or zoneCode' });

	try {
		const caller = await requireShelterManagerOrSA(request.headers.get('cookie'), code);

		const body = (await request.json().catch(() => ({}))) as unknown;
		const parsed = closeZoneSchema.parse(body);

		const result = await applyZoneTransition('close', {
			code,
			zoneCode,
			actor: caller.name,
			reason: parsed.reason ?? null
		});
		if ('lost' in result) {
			return error(500, { message: 'Zone update lost during write' });
		}

		return json({
			ok: true,
			code,
			zoneCode,
			status: 'closed',
			closed_at: result.updatedZone.closed_at
		});
	} catch (e) {
		return serviceError(e);
	}
};

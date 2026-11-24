import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterManagerOrSA, serviceError } from '$lib/server/couch-admin';
import { applyZoneTransition } from '$lib/server/shelter-zones';

export const prerender = false;

/**
 * POST /api/back-office/shelter/{code}/zones/{zoneCode}/reopen
 * Body: {}
 * - reopen: set status='active', record reopened_at/reopened_by, clear close metadata,
 *   append audit log. Returns 409 if the zone is already active.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	const zoneCode = params.zoneCode;
	if (!code || !zoneCode) return error(400, { message: 'Missing code or zoneCode' });

	try {
		const caller = await requireShelterManagerOrSA(request.headers.get('cookie'), code);

		const result = await applyZoneTransition('reopen', {
			code,
			zoneCode,
			actor: caller.name
		});
		if ('lost' in result) {
			return error(500, { message: 'Zone update lost during write' });
		}

		return json({
			ok: true,
			code,
			zoneCode,
			status: 'active',
			reopened_at: result.updatedZone.reopened_at
		});
	} catch (e) {
		return serviceError(e);
	}
};

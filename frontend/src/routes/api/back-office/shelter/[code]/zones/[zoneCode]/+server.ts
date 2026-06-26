import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import {
	adminRaw,
	requireShelterManagerOrSA,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import { ulid } from '$lib/db/ulid';
import type { Zone } from '$lib/features/shelters/server';
import { nowIso, updateMaster } from '$lib/server/shelters.admin';

export const prerender = false;

const closeZoneSchema = z.object({
	reason: z.string().trim().optional().nullable(),
	closed_by: z.string().trim().optional().nullable()
});

/**
 * POST /api/back-office/shelter/{code}/zones/{zoneCode}
 * Body: { reason?: string, closed_by?: string }
 * - close: set status='closed', record closed_at/closed_by/reason, append audit log
 *   Returns 409 if the zone is already closed.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	const zoneCode = params.zoneCode;
	if (!code || !zoneCode) return error(400, { message: 'Missing code or zoneCode' });

	try {
		await requireShelterManagerOrSA(request.headers.get('cookie'), code);

		const body = (await request.json().catch(() => ({}))) as unknown;
		const parsed = closeZoneSchema.parse(body);
		const reason = parsed.reason ?? null;
		const closedBy = parsed.closed_by ?? null;

		// updateMaster retries on 409 (skill: couchdb-pouchdb-bestpractices §3).
		// The mutator returns the new zone shape in `meta` so we can echo it
		// back in the response without re-reading the master doc.
		const { meta } = await updateMaster<{ updatedZone: Zone; previousStatus: string }>(
			code,
			(current) => {
				const zones = current.zones ?? [];
				const zoneIndex = zones.findIndex((z) => z.code === zoneCode);
				if (zoneIndex === -1) {
					throw new ServiceError('VALIDATION', `Zone "${zoneCode}" not found in shelter ${code}`);
				}
				const target = zones[zoneIndex];
				if (target.status === 'closed') {
					throw new ServiceError('CONFLICT', `Zone "${zoneCode}" is already closed`);
				}
				const updatedZone: Zone = {
					...target,
					status: 'closed',
					closed_at: nowIso(),
					closed_by: closedBy,
					reopened_at: null,
					reopened_by: null,
					reason
				};
				return {
					patch: {
						zones: zones.map((z, i) => (i === zoneIndex ? updatedZone : z))
					},
					meta: { updatedZone, previousStatus: target.status }
				};
			}
		);

		if (!meta) {
			return error(500, { message: 'Zone update lost during write' });
		}
		const updatedZone = meta.updatedZone;
		const previousStatus = meta.previousStatus;

		// Append audit log (per data-model.md §3.6) — ULID for collision-safe id.
		const auditDoc = {
			_id: `audit:${ulid()}`,
			type: 'audit',
			schema_v: 1,
			shelter_code: code,
			action: 'zone.close',
			target_type: 'shelter_zone',
			target_id: `${code}:${zoneCode}`,
			reason: reason ?? '',
			context: { zone_code: zoneCode, previous_status: previousStatus, actor: closedBy },
			occurred_at: nowIso()
		};
		await adminRaw(`/registry/${encodeURIComponent(auditDoc._id)}`, 'PUT', auditDoc);

		return json({
			ok: true,
			code,
			zoneCode,
			status: 'closed',
			closed_at: updatedZone.closed_at
		});
	} catch (e) {
		return serviceError(e);
	}
};

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { adminRaw, requireShelterManagerOrSA, serviceError, ServiceError } from '$lib/server/couch-admin';
import { ulid } from '$lib/db/ulid';
import type { Zone } from '$lib/features/shelters/domain/schema';
import { nowIso, updateMaster } from '$lib/server/shelters.admin';

export const prerender = false;

const reopenZoneSchema = z.object({
	reopened_by: z.string().trim().optional().nullable()
});

/**
 * POST /api/back-office/shelter/{code}/zones/{zoneCode}/reopen
 * Body: { reopened_by?: string }
 * - reopen: set status='active', record reopened_at/reopened_by, clear close metadata,
 *   append audit log. Returns 409 if the zone is already active.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	const zoneCode = params.zoneCode;
	if (!code || !zoneCode) return error(400, { message: 'Missing code or zoneCode' });

	try {
		await requireShelterManagerOrSA(request.headers.get('cookie'), code);

		const body = (await request.json().catch(() => ({}))) as unknown;
		const parsed = reopenZoneSchema.parse(body);
		const reopenedBy = parsed.reopened_by ?? null;

		const { meta } = await updateMaster<{ updatedZone: Zone; previousStatus: string }>(
			code,
			(current) => {
				const zones = current.zones ?? [];
				const zoneIndex = zones.findIndex((z) => z.code === zoneCode);
				if (zoneIndex === -1) {
					throw new ServiceError(
						'VALIDATION',
						`Zone "${zoneCode}" not found in shelter ${code}`
					);
				}
				const target = zones[zoneIndex];
				if (target.status === 'active') {
					throw new ServiceError('CONFLICT', `Zone "${zoneCode}" is already active`);
				}
				const updatedZone: Zone = {
					...target,
					status: 'active',
					closed_at: null,
					closed_by: null,
					reopened_at: nowIso(),
					reopened_by: reopenedBy,
					reason: null
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
			action: 'zone.reopen',
			target_type: 'shelter_zone',
			target_id: `${code}:${zoneCode}`,
			reason: '',
			context: { zone_code: zoneCode, previous_status: previousStatus, actor: reopenedBy },
			occurred_at: nowIso()
		};
		await adminRaw(
			`/registry/${encodeURIComponent(auditDoc._id)}`,
			'PUT',
			auditDoc
		);

		return json({
			ok: true,
			code,
			zoneCode,
			status: 'active',
			reopened_at: updatedZone.reopened_at
		});
	} catch (e) {
		return serviceError(e);
	}
};

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { adminRaw, requireAdmin, serviceError, ServiceError } from '$lib/server/couch-admin';
import { ulid } from '$lib/db/ulid';
import {
	migrateShelterV2ToCurrent,
	type ShelterMaster,
	type ShelterMasterV2,
	type Zone
} from '$lib/features/shelters';

export const prerender = false;

const REGISTRY_DB = 'registry';

const reopenZoneSchema = z.object({
	reopened_by: z.string().trim().optional().nullable()
});

function nowIso(): string {
	return new Date().toISOString();
}

async function findMasterByCode(code: string): Promise<ShelterMaster | null> {
	const res = await adminRaw(`/${REGISTRY_DB}/_all_docs?include_docs=true`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not read registry');
	const rows = (res.data as { rows?: { id: string; doc: unknown }[] })?.rows ?? [];
	const match = rows.find(
		(r) => r.id.startsWith('shelter:') && r.doc && (r.doc as { code?: string }).code === code
	);
	return (match?.doc as ShelterMaster) ?? null;
}

function migrate(master: ShelterMasterV2 | ShelterMaster): ShelterMaster {
	if (master.schema_v >= 3) return master as ShelterMaster;
	return migrateShelterV2ToCurrent(master);
}

/**
 * POST /api/back-office/shelter/{code}/zones/{zoneCode}/reopen
 * Body: { reopened_by?: string }
 * - reopen: set status='active', clear closed_at/closed_by/reason, append audit log
 *   Returns 409 if the zone is already active.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const code = params.code;
		const zoneCode = params.zoneCode;
		if (!code || !zoneCode) {
			return error(400, { message: 'Missing code or zoneCode' });
		}

		const body = (await request.json().catch(() => ({}))) as unknown;
		const parsed = reopenZoneSchema.parse(body);
		const reopenedBy = parsed.reopened_by ?? null;

		const master = await findMasterByCode(code);
		if (!master) {
			return error(404, { message: `Shelter "${code}" not found` });
		}
		if (!master._rev) {
			return error(500, { message: 'Shelter master doc has no _rev' });
		}

		const migrated = migrate(master);
		const zones = migrated.zones ?? [];
		const zoneIndex = zones.findIndex((z) => z.code === zoneCode);
		if (zoneIndex === -1) {
			return error(404, { message: `Zone "${zoneCode}" not found in shelter ${code}` });
		}

		const currentZone = zones[zoneIndex];
		if (currentZone.status === 'active') {
			return error(409, { message: `Zone "${zoneCode}" is already active` });
		}

		const now = nowIso();
		const updatedZone: Zone = {
			...currentZone,
			status: 'active',
			closed_at: null,
			closed_by: null,
			reason: null
		};
		const updatedZones = zones.map((z, i) => (i === zoneIndex ? updatedZone : z));

		const finalMaster: ShelterMaster = {
			...migrated,
			zones: updatedZones,
			updated_at: now
		};

		const writeRes = await adminRaw(
			`/${REGISTRY_DB}/${encodeURIComponent(migrated._id)}`,
			'PUT',
			finalMaster
		);
		if (writeRes.status >= 400) {
			const couchErr = writeRes.data as { error?: string; reason?: string } | null;
			const detail = couchErr?.reason ?? couchErr?.error ?? 'unknown';
			throw new ServiceError('INTERNAL', `Registry PUT failed (${writeRes.status}): ${detail}`);
		}

		// Append audit log (per data-model.md §3.6) — ULID for collision-safe id.
		const auditDoc = {
			_id: `audit:${ulid()}`,
			type: 'audit',
			schema_v: 1,
			shelter_code: code,
			action: 'zone.reopen',
			target_type: 'shelter_zone',
			target_id: `${code}:${zoneCode}`,
			reason: reopenedBy ? `reopened_by:${reopenedBy}` : '',
			context: { zone_code: zoneCode, previous_status: currentZone.status },
			occurred_at: now
		};
		await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(auditDoc._id)}`, 'PUT', auditDoc);

		return json({
			ok: true,
			code,
			zoneCode,
			status: 'active',
			closed_at: null
		});
	} catch (e) {
		return serviceError(e);
	}
};

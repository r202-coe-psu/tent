import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { adminRaw, requireAdmin, serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	migrateShelterV2ToCurrent,
	type ShelterMaster,
	type ShelterMasterV2
} from '$lib/features/shelters';

export const prerender = false;

const REGISTRY_DB = 'registry';

const closeZoneSchema = z.object({
	reason: z.string().trim().optional().nullable()
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

interface ZoneCloseBody {
	action?: 'close';
	reason?: string | null;
}

/**
 * POST /api/back-office/shelter/{code}/zones/{zoneCode}
 * Body: { reason?: string }
 * - close: set status='closed', record closed_at/closed_by/reason, append audit log
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
		const parsed = closeZoneSchema.parse(body) as ZoneCloseBody;
		const reason = parsed.reason ?? null;

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

		const now = nowIso();
		const currentZone = zones[zoneIndex];
		if (currentZone.status === 'closed') {
			return error(409, { message: `Zone "${zoneCode}" is already closed` });
		}

		const updatedZone = {
			...currentZone,
			status: 'closed' as const,
			closed_at: now,
			closed_by: 'admin', // TODO: replace with session user_id when auth context is available
			reason
		};

		const updatedMaster: ShelterMaster = {
			...migrated,
			zones: zones.map((z, i) => (i === zoneIndex ? updatedZone : z)),
			updated_at: now
		};

		// Write updated master
		const writeRes = await adminRaw(
			`/${REGISTRY_DB}/${encodeURIComponent(migrated._id)}`,
			'PUT',
			updatedMaster
		);
		if (writeRes.status >= 400) {
			const couchErr = writeRes.data as { error?: string; reason?: string } | null;
			const detail = couchErr?.reason ?? couchErr?.error ?? 'unknown';
			throw new ServiceError('INTERNAL', `Registry PATCH failed (${writeRes.status}): ${detail}`);
		}

		// Append audit log (per data-model.md §3.6)
		const auditDoc = {
			_id: `audit:${now}-${zoneCode}`,
			type: 'audit',
			schema_v: 1,
			shelter_code: code,
			action: 'zone.close',
			target_type: 'shelter_zone',
			target_id: `${code}:${zoneCode}`,
			reason: reason ?? '',
			context: { zone_code: zoneCode, previous_status: currentZone.status },
			occurred_at: now
		};
		await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(auditDoc._id)}`, 'PUT', auditDoc);

		return json({
			ok: true,
			code,
			zoneCode,
			status: updatedZone.status,
			closed_at: updatedZone.closed_at
		});
	} catch (e) {
		return serviceError(e);
	}
};

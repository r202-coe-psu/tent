import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	requireAdmin,
	requireShelterScopeOrSA,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import {
	enforceOneDefault,
	masterDataSchema,
	masterTypeSchema,
	type MasterData
} from '$lib/features/master-data/domain';
import { readMasterDoc } from '$lib/server/master-data-server';

export const prerender = false;

const REGISTRY_DB = 'registry';

/** GET — read one master_data doc (404 → empty placeholder). Reads are open to
 *  any authenticated user (CR-012 §2); writes below stay SA-only. */
export const GET: RequestHandler = async ({ params, request }) => {
	await requireShelterScopeOrSA(request.headers.get('cookie'));
	try {
		const type = masterTypeSchema.parse(params.type);
		const doc = await readMasterDoc(type);
		return json({
			_id: `master_data:${type}`,
			master_type: type,
			items: doc?.items ?? []
		});
	} catch (e) {
		return serviceError(e);
	}
};

/** PUT — replace the whole `items` array. Admin UI sends the canonical list
 *  (after add/edit/delete/setDefault ran client-side). Idempotent on first
 *  write (creates the doc with a fresh envelope). */
export const PUT: RequestHandler = async ({ params, request }) => {
	const caller = await requireAdmin(request.headers.get('cookie'));
	try {
		const type = masterTypeSchema.parse(params.type);
		const body = (await request.json().catch(() => ({}))) as { items?: unknown };
		if (!Array.isArray(body.items)) {
			throw new ServiceError('VALIDATION', 'items[] is required');
		}
		const cleaned = enforceOneDefault(
			masterDataSchema.shape.items.parse(body.items) as MasterData['items']
		);

		const id = `master_data:${type}`;
		const existing = await readMasterDoc(type);
		const now = new Date().toISOString();
		const doc: MasterData = existing
			? { ...existing, items: cleaned, updated_at: now }
			: {
					_id: id,
					type: 'master_data',
					schema_v: 1,
					master_type: type,
					items: cleaned,
					created_at: now,
					updated_at: now,
					created_by: caller
				};

		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'PUT', doc);
		if (res.status === 409) {
			throw new ServiceError(
				'CONFLICT',
				'Document was modified by another user — reload and retry'
			);
		}
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', `CouchDB write failed (${res.status})`);
		}
		const rev = (res.data as { rev?: string })?.rev;
		if (!rev) throw new ServiceError('INTERNAL', 'CouchDB did not return a rev');
		return json({ ok: true, rev });
	} catch (e) {
		return serviceError(e);
	}
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin, serviceError, ServiceError } from '$lib/server/couch-admin';
import { masterTypeSchema, type MasterData } from '$lib/features/master-data';
import { readMasterDoc } from '$lib/server/master-data-server';

/**
 * Dev-only admin API: hard-delete a single item from a master_data doc.
 *
 * Strategy: read the doc, filter the item out, write the doc back. (No
 * granular array-element update in CouchDB — the doc is the unit of write.)
 * The admin UI will treat the absence of the code as the delete signal; no
 * `active=false` soft-delete in Phase 1.
 */
export const prerender = false;

const REGISTRY_DB = 'registry';

/** DELETE — remove the item with the given code from the array. Idempotent:
 *  if the code isn't in the array, returns 200 with the current rev. */
export const DELETE: RequestHandler = async ({ params, request }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const type = masterTypeSchema.parse(params.type);
		const code = String(params.code ?? '').trim();
		if (!code) throw new ServiceError('VALIDATION', 'code is required');

		const doc = await readMasterDoc(type);
		if (!doc) {
			throw new ServiceError('CONFLICT', `master_data:${type} does not exist yet`);
		}
		const before = doc.items.length;
		const filtered = doc.items.filter((i) => i.code !== code);
		if (filtered.length === before) {
			// Idempotent: item already gone, treat as success.
			return json({ ok: true, rev: doc._rev ?? '' });
		}

		const next: MasterData = {
			...doc,
			items: filtered,
			updated_at: new Date().toISOString()
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(doc._id)}`, 'PUT', next);
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

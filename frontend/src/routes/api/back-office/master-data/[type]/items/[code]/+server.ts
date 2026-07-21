import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin, serviceError, ServiceError } from '$lib/server/couch-admin';
import { masterDocId, masterTypeSchema, type MasterData } from '$lib/features/master-data/domain';
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
	const caller = await requireAdmin(request.headers.get('cookie'));
	try {
		const type = masterTypeSchema.parse(params.type);
		const code = String(params.code ?? '').trim();
		if (!code) throw new ServiceError('VALIDATION', 'code is required');

		const scope = parseScope(request);
		if (scope.mode === 'effective') {
			throw new ServiceError('VALIDATION', 'DELETE requires global or shelter scope');
		}
		const localDoc = await readMasterDoc(type, scope.shelterCode);
		const creatingLocalFromGlobal = !localDoc && scope.mode === 'shelter' && !!scope.shelterCode;
		const doc = localDoc ?? (creatingLocalFromGlobal ? await readMasterDoc(type) : null);
		if (!doc) {
			throw new ServiceError('CONFLICT', `master_data:${type} does not exist yet`);
		}
		const before = doc.items.length;
		const filtered = doc.items.filter((i) => i.code !== code);
		if (filtered.length === before) {
			// Idempotent: item already gone, treat as success.
			return json({ ok: true, rev: doc._rev ?? '' });
		}

		const now = new Date().toISOString();
		let next: MasterData;
		if (creatingLocalFromGlobal && scope.shelterCode) {
			const globalWithoutRev = { ...doc };
			delete globalWithoutRev._rev;
			next = {
				...globalWithoutRev,
				_id: masterDocId(type, scope.shelterCode),
				schema_v: 2,
				shelter_code: scope.shelterCode,
				items: filtered,
				created_at: now,
				updated_at: now,
				created_by: caller
			};
		} else {
			next = {
				...doc,
				schema_v: 2,
				items: filtered,
				updated_at: now
			};
		}
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
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

function parseScope(request: Request): {
	mode: 'global' | 'shelter' | 'effective';
	shelterCode?: string;
} {
	const url = new URL(request.url);
	const requested = url.searchParams.get('scope');
	const shelterCode = url.searchParams.get('shelter_code') || undefined;
	const mode = (requested ?? (shelterCode ? 'shelter' : 'global')) as
		'global' | 'shelter' | 'effective';
	if (!['global', 'shelter', 'effective'].includes(mode)) {
		throw new ServiceError('VALIDATION', 'Invalid master-data scope');
	}
	if (mode === 'global' && shelterCode) {
		throw new ServiceError('VALIDATION', 'Global master data cannot include shelter_code');
	}
	if ((mode === 'shelter' || mode === 'effective') && !shelterCode) {
		throw new ServiceError('VALIDATION', 'shelter_code is required for this scope');
	}
	if (shelterCode && !/^[A-Za-z0-9_-]{1,20}$/.test(shelterCode)) {
		throw new ServiceError('VALIDATION', 'Invalid shelter_code');
	}
	return { mode, ...(shelterCode ? { shelterCode } : {}) };
}

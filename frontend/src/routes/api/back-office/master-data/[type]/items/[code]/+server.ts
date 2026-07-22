import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	requireAdmin,
	requireShelterScopeOrSA,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import { masterDocId, masterTypeSchema, type MasterData } from '$lib/features/master-data/domain';
import {
	mergeMasterDataItems,
	readMasterDoc,
	splitMasterDataItems
} from '$lib/server/master-data-server';

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
	try {
		const type = masterTypeSchema.parse(params.type);
		const code = String(params.code ?? '').trim();
		if (!code) throw new ServiceError('VALIDATION', 'code is required');

		const scope = parseScope(request);
		if (scope.mode === 'effective') {
			throw new ServiceError('VALIDATION', 'DELETE requires global or shelter scope');
		}
		const caller =
			scope.mode === 'shelter'
				? (await requireShelterScopeOrSA(request.headers.get('cookie'), scope.shelterCode!)).name
				: await requireAdmin(request.headers.get('cookie'));

		const globalDoc = await readMasterDoc(type);
		if (scope.mode === 'global') {
			if (!globalDoc) {
				throw new ServiceError('CONFLICT', `master_data:${type} does not exist yet`);
			}
			const filtered = globalDoc.items.filter((item) => item.code !== code);
			if (filtered.length === globalDoc.items.length) {
				return json({ ok: true, rev: globalDoc._rev ?? '' });
			}
			const next: MasterData = {
				...globalDoc,
				schema_v: 2,
				items: filtered,
				updated_at: new Date().toISOString()
			};
			delete next.shelter_code;
			delete next.excluded_codes;
			return await writeMasterDoc(next);
		}

		const localDoc = scope.shelterCode ? await readMasterDoc(type, scope.shelterCode) : null;
		const effective = mergeMasterDataItems(globalDoc, localDoc, scope.shelterCode);
		if (!effective.items.some((item) => item.code === code)) {
			return json({ ok: true, rev: localDoc?._rev ?? '' });
		}

		const nextEffectiveItems = effective.items.filter((item) => item.code !== code);
		const overlay = splitMasterDataItems(nextEffectiveItems, globalDoc);
		const now = new Date().toISOString();
		const next: MasterData = localDoc
			? {
					...localDoc,
					schema_v: 2,
					items: overlay.items,
					updated_at: now,
					...(overlay.excludedCodes.length ? { excluded_codes: overlay.excludedCodes } : {})
				}
			: {
					_id: masterDocId(type, scope.shelterCode),
					type: 'master_data',
					schema_v: 2,
					master_type: type,
					shelter_code: scope.shelterCode!,
					items: overlay.items,
					...(overlay.excludedCodes.length ? { excluded_codes: overlay.excludedCodes } : {}),
					created_at: now,
					updated_at: now,
					created_by: caller
				};
		if (!overlay.excludedCodes.length) delete next.excluded_codes;
		return await writeMasterDoc(next);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		return serviceError(e);
	}
};

async function writeMasterDoc(next: MasterData): Promise<Response> {
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
	if (res.status === 409) {
		throw new ServiceError('CONFLICT', 'Document was modified by another user — reload and retry');
	}
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `CouchDB write failed (${res.status})`);
	}
	const rev = (res.data as { rev?: string })?.rev;
	if (!rev) throw new ServiceError('INTERNAL', 'CouchDB did not return a rev');
	return json({ ok: true, rev });
}

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

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA, serviceError, ServiceError } from '$lib/server/couch-admin';
import { MASTER_DATA_TYPES, masterDocId } from '$lib/features/master-data/domain';
import { mergeMasterDataItems, readMasterDoc } from '$lib/server/master-data-server';

/**
 * Dev-only admin API for the Master Data Engine (CR-012). Never prerendered
 * (absent from the static prod build) — production builds run this through a
 * reverse proxy → FastAPI. Reads (GET) are open to any authenticated user
 * (CR-012 §2: "Read: any authenticated role") so shelter staff can populate
 * registration dropdowns; the server still uses admin creds to reach `registry`.
 */
export const prerender = false;

/** GET — list effective master_data docs (one per master_type in MASTER_DATA_TYPES).
 *  Missing docs come back as `{ items: [] }` placeholders so the UI can render
 *  a card for every type. */
export const GET: RequestHandler = async ({ request }) => {
	let scope: ReturnType<typeof parseScope>;
	try {
		scope = parseScope(request);
	} catch (e) {
		return serviceError(e);
	}

	const { shelterCode } = scope;
	if (shelterCode) {
		await requireShelterScopeOrSA(request.headers.get('cookie'), shelterCode);
	} else {
		await requireShelterScopeOrSA(request.headers.get('cookie'));
	}

	try {
		const out = await Promise.all(
			MASTER_DATA_TYPES.map(async (type) => {
				const global = scope.scope === 'shelter' ? null : await readMasterDoc(type);
				const local = shelterCode ? await readMasterDoc(type, shelterCode) : null;
				const effective =
					scope.scope === 'effective' ? mergeMasterDataItems(global, local, shelterCode) : null;
				const doc = local ?? global;
				const items = effective?.items ?? doc?.items ?? [];
				const itemSources =
					effective?.itemSources ??
					Object.fromEntries(
						items.map((item) => [
							item.code,
							{
								scope: scope.scope === 'shelter' ? 'shelter' : 'global',
								shelter_code: shelterCode ?? null
							}
						])
					);
				return {
					_id: doc?._id ?? masterDocId(type, scope.scope === 'shelter' ? shelterCode : undefined),
					master_type: type,
					items,
					scope: scope.scope,
					shelter_code: shelterCode ?? null,
					source_shelter_code: local?.shelter_code ?? null,
					item_sources: itemSources
				};
			})
		);
		return json(out);
	} catch (e) {
		return serviceError(e);
	}
};

function parseScope(request: Request): {
	scope: 'global' | 'shelter' | 'effective';
	shelterCode?: string;
} {
	const url = new URL(request.url);
	const requested = url.searchParams.get('scope');
	const shelterCode = url.searchParams.get('shelter_code') || undefined;
	const scope = (requested ?? (shelterCode ? 'shelter' : 'global')) as
		'global' | 'shelter' | 'effective';
	if (!['global', 'shelter', 'effective'].includes(scope)) {
		throw new ServiceError('VALIDATION', 'Invalid master-data scope');
	}
	if ((scope === 'shelter' || scope === 'effective') && !shelterCode) {
		throw new ServiceError('VALIDATION', 'shelter_code is required for this scope');
	}
	if (scope === 'global' && shelterCode) {
		throw new ServiceError('VALIDATION', 'Global master data cannot include shelter_code');
	}
	if (shelterCode && !/^[A-Za-z0-9_-]{1,20}$/.test(shelterCode)) {
		throw new ServiceError('VALIDATION', 'Invalid shelter_code');
	}
	return { scope, ...(shelterCode ? { shelterCode } : {}) };
}

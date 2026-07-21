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
	masterDocId,
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
	let type: ReturnType<typeof masterTypeSchema.parse>;
	let scope: ParsedScope;
	try {
		type = masterTypeSchema.parse(params.type);
		scope = parseScope(request);
	} catch (e) {
		return serviceError(e);
	}
	await requireShelterScopeOrSA(request.headers.get('cookie'), scope.shelterCode);
	try {
		const local = scope.shelterCode ? await readMasterDoc(type, scope.shelterCode) : null;
		const doc = local ?? (scope.mode === 'shelter' ? null : await readMasterDoc(type));
		return json({
			_id: doc?._id ?? masterDocId(type, scope.mode === 'shelter' ? scope.shelterCode : undefined),
			master_type: type,
			items: doc?.items ?? [],
			scope: doc?.shelter_code ? 'shelter' : 'global',
			shelter_code: doc?.shelter_code ?? null,
			source_shelter_code: doc?.shelter_code ?? null
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
		const body = (await request.json().catch(() => ({}))) as {
			items?: unknown;
			shelter_code?: unknown;
		};
		const scope = parseScope(request, body.shelter_code);
		if (scope.mode === 'effective') {
			throw new ServiceError('VALIDATION', 'PUT requires global or shelter scope');
		}
		if (!Array.isArray(body.items)) {
			throw new ServiceError('VALIDATION', 'items[] is required');
		}
		const cleaned = enforceOneDefault(
			masterDataSchema.shape.items.parse(body.items) as MasterData['items']
		);

		const id = masterDocId(type, scope.shelterCode);
		const existing = await readMasterDoc(type, scope.shelterCode);
		const now = new Date().toISOString();
		const doc: MasterData = existing
			? {
					...existing,
					schema_v: 2,
					...(scope.shelterCode ? { shelter_code: scope.shelterCode } : {}),
					items: cleaned,
					updated_at: now
				}
			: {
					_id: id,
					type: 'master_data',
					schema_v: 2,
					master_type: type,
					...(scope.shelterCode ? { shelter_code: scope.shelterCode } : {}),
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

type ParsedScope = { mode: 'global' | 'shelter' | 'effective'; shelterCode?: string };

function parseScope(request: Request, bodyShelterCode?: unknown): ParsedScope {
	const url = new URL(request.url);
	const requested = url.searchParams.get('scope');
	const queryCode = url.searchParams.get('shelter_code') || undefined;
	const bodyCode =
		typeof bodyShelterCode === 'string' ? bodyShelterCode.trim() || undefined : undefined;
	if (queryCode && bodyCode && queryCode !== bodyCode) {
		throw new ServiceError('VALIDATION', 'shelter_code does not match the query context');
	}
	const shelterCode = queryCode ?? bodyCode;
	const mode = (requested ?? (shelterCode ? 'shelter' : 'global')) as ParsedScope['mode'];
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

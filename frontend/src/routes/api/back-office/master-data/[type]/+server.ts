import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	requireAdmin,
	requireShelterManagerOrSA,
	requireShelterScopeOrSA,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import {
	dedupeItemsByCode,
	duplicateLabelKeys,
	enforceOneDefault,
	findLabelCollision,
	masterDocId,
	masterDataSchema,
	masterTypeSchema,
	type MasterData
} from '$lib/features/master-data/domain';
import {
	mergeMasterDataItems,
	readMasterDoc,
	readShelterMasterDocs
} from '$lib/server/master-data-server';

export const prerender = false;

const REGISTRY_DB = 'registry';

/** GET — read one master_data doc (404 → empty placeholder). */
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
		const global = scope.mode === 'shelter' ? null : await readMasterDoc(type);
		const local = scope.shelterCode ? await readMasterDoc(type, scope.shelterCode) : null;
		const effective =
			scope.mode === 'effective' ? mergeMasterDataItems(global, local, scope.shelterCode) : null;
		const doc = local ?? global;
		const items = effective?.items ?? doc?.items ?? [];
		const itemSources =
			effective?.itemSources ??
			Object.fromEntries(
				items.map((item) => [
					item.code,
					{
						scope: scope.mode === 'shelter' ? 'shelter' : 'global',
						shelter_code: scope.shelterCode ?? null
					}
				])
			);
		return json({
			_id: doc?._id ?? masterDocId(type, scope.mode === 'shelter' ? scope.shelterCode : undefined),
			master_type: type,
			items,
			scope: scope.mode,
			shelter_code: scope.shelterCode ?? null,
			source_shelter_code: local?.shelter_code ?? null,
			item_sources: itemSources
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		return serviceError(e);
	}
};

/** PUT — replace the whole `items` array of the target doc (global or
 *  shelter-local) verbatim. The UI sends only the items that belong to that
 *  scope — for shelter scope that's the shelter-local items only, since the
 *  global list is read-only client-side. No split, no overlay, no
 *  excluded_codes bookkeeping: the submitted array becomes the doc's items. */
export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const type = masterTypeSchema.parse(params.type);
		const body = (await request.json().catch(() => ({}))) as {
			items?: unknown;
			shelter_code?: unknown;
			disabled_global_codes?: unknown;
			default_global_code?: unknown;
		};
		const scope = parseScope(request, body.shelter_code);
		if (scope.mode === 'effective') {
			throw new ServiceError('VALIDATION', 'PUT requires global or shelter scope');
		}
		// Writes are SM-or-SA (FR-049-10): shelter-local master data may only be
		// mutated by the shelter's manager or a system admin — not general staff
		// (requireShelterScopeOrSA is a read-only gate). Global writes stay SA-only.
		const caller =
			scope.mode === 'shelter'
				? (await requireShelterManagerOrSA(request.headers.get('cookie'), scope.shelterCode!)).name
				: await requireAdmin(request.headers.get('cookie'));
		if (!Array.isArray(body.items)) {
			throw new ServiceError('VALIDATION', 'items[] is required');
		}
		// dedupeItemsByCode repairs a doc that recorded one item twice (CR-078) —
		// while it stands, every UI action matches both copies, so the operator
		// cannot fix it from the screen. Collapse it here on the next save.
		const cleaned = enforceOneDefault(
			dedupeItemsByCode(masterDataSchema.shape.items.parse(body.items) as MasterData['items'])
		);

		const id = masterDocId(type, scope.shelterCode);
		const existing = await readMasterDoc(type, scope.shelterCode);

		// Unique label per master type (CR-078). This is the enforcing gate — the
		// modal blocks the same collision client-side, but a direct PUT must not
		// slip past it. Inactive items count: their `code` stays referenced by
		// existing records (soft-delete, schema.md §3.3).
		//
		// The cross-tier check runs BOTH ways, because the shelter UI renders the
		// merged global + local list and a collision from either direction shows
		// two rows that read identically: a shelter write is checked against the
		// global items, and a global write against every shelter's items.
		const otherTier = scope.shelterCode
			? ((await readMasterDoc(type))?.items ?? [])
			: (await readShelterMasterDocs(type)).flatMap((d) => d.items);
		// Labels that already collided before this write are skipped — data that
		// predates the rule must not brick every later edit of the type (a status
		// toggle would otherwise be rejected with no way to reach the bad item).
		const grandfathered = duplicateLabelKeys(existing?.items ?? [], otherTier);
		const collision = findLabelCollision(cleaned, otherTier, grandfathered);
		if (collision) {
			throw new ServiceError('VALIDATION', `มีรายการชื่อ "${collision}" อยู่แล้วในประเภทนี้`);
		}
		const now = new Date().toISOString();
		let doc: MasterData;
		if (scope.shelterCode) {
			doc = existing
				? {
						...existing,
						schema_v: 3,
						shelter_code: scope.shelterCode,
						items: cleaned,
						updated_at: now
					}
				: {
						_id: id,
						type: 'master_data',
						schema_v: 3,
						master_type: type,
						shelter_code: scope.shelterCode,
						items: cleaned,
						created_at: now,
						updated_at: now,
						created_by: caller
					};
		} else {
			doc = existing
				? {
						...existing,
						schema_v: 3,
						items: cleaned,
						updated_at: now
					}
				: {
						_id: id,
						type: 'master_data',
						schema_v: 3,
						master_type: type,
						items: cleaned,
						created_at: now,
						updated_at: now,
						created_by: caller
					};
			delete doc.shelter_code;
			// Global docs never carry a per-shelter disable list or default pointer.
			delete doc.disabled_global_codes;
			delete doc.default_global_code;
		}
		// Spreading `...existing` can carry a leftover `excluded_codes` from a v2
		// doc — strip it so the persisted shape is clean schema_v 3 (CR-049).
		delete (doc as MasterData & { excluded_codes?: string[] }).excluded_codes;

		// Per-shelter disable list (CR-049 amendment): only when the client sends
		// it (a global-item toggle). An items-only PUT (shelter-local edit) omits
		// the key, so `...existing` preserves the current disable list.
		if (scope.shelterCode && 'disabled_global_codes' in body) {
			const codes = Array.isArray(body.disabled_global_codes)
				? body.disabled_global_codes.filter((c): c is string => typeof c === 'string' && !!c.trim())
				: [];
			if (codes.length) doc.disabled_global_codes = codes;
			else delete doc.disabled_global_codes;
		}

		// Shelter's chosen GLOBAL default (CR-049 amendment): only when the
		// client sends the key. A non-empty string sets the pointer; an empty
		// string/null clears it (revert to the global doc's own `is_default`).
		// Never persisted on the global doc.
		if (scope.shelterCode && 'default_global_code' in body) {
			const code =
				typeof body.default_global_code === 'string' ? body.default_global_code.trim() : '';
			if (code) doc.default_global_code = code;
			else delete doc.default_global_code;
		}

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
		if (e && typeof e === 'object' && 'status' in e) throw e;
		return serviceError(e);
	}
};

type ParsedScope = { mode: 'global' | 'shelter' | 'effective'; shelterCode?: string };

function parseScope(request: Request, bodyShelterCode?: unknown): ParsedScope {
	const url = new URL(request.url);
	const requested = url.searchParams.get('scope');
	// Canonicalize query scope to match the trimmed body shelter_code value.
	const queryCode = url.searchParams.get('shelter_code')?.trim() || undefined;
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

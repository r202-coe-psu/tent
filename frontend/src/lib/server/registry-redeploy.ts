/**
 * Registry steps of `scripts/redeploy-access.ts` (`pnpm db:sync`).
 *
 * The registry `_design/app` (by_code / by_code_number / by_name views) must be
 * deployed even when the registry holds zero shelters — the first shelter
 * create (`findMasterByName`) needs those views to exist.
 *
 * Deliberately free of `$env` and `@sveltejs/kit` so the plain-`tsx` script can
 * import it; Couch HTTP is injected as `couchReq`.
 */

import type { CouchReq } from './ensure-public-writer';
import { buildRegistryDesignDoc, REGISTRY_DB, REGISTRY_DESIGN_ID } from './registry-design';

export interface ShelterMasterRow {
	code: string;
}

export async function listShelterMasters(couchReq: CouchReq): Promise<ShelterMasterRow[]> {
	const res = await couchReq('GET', `/${REGISTRY_DB}/_all_docs?include_docs=true`);
	if (res.status === 404) return [];
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Could not read registry (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	const rows = (res.data as { rows?: { id: string; doc?: { code?: string } }[] })?.rows ?? [];
	return rows
		.filter((r) => r.id.startsWith('shelter:') && r.doc?.code)
		.map((r) => ({ code: r.doc!.code! }));
}

/**
 * Idempotent PUT of the registry `_design/app` (views + write policy) so
 * `findMasterByCode` / `findMasterByName` and the public booking BFF resolve a
 * shelter through an index instead of scanning the whole registry.
 */
export async function deployRegistryDesign(
	couchReq: CouchReq,
	dryRun: boolean
): Promise<'current' | 'deployed'> {
	const desired = buildRegistryDesignDoc();
	const existing = await couchReq('GET', `/${REGISTRY_DB}/${REGISTRY_DESIGN_ID}`);
	const current =
		existing.status === 200
			? (existing.data as {
					_rev?: string;
					version?: number;
					views?: Record<string, { map: string }>;
					validate_doc_update?: string;
				} | null)
			: null;

	if (
		current &&
		current.version === desired.version &&
		current.validate_doc_update === desired.validate_doc_update &&
		Object.entries(desired.views).every(([name, view]) => current.views?.[name]?.map === view.map)
	) {
		return 'current';
	}
	if (dryRun) return 'deployed';

	const res = await couchReq('PUT', `/${REGISTRY_DB}/${REGISTRY_DESIGN_ID}`, {
		...desired,
		...(current?._rev ? { _rev: current._rev } : {})
	});
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`registry _design/app deploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return 'deployed';
}

/**
 * Registry design first, shelter list second — so a fresh install with an empty
 * registry still gets its views before the caller bails out of the shelter loop.
 */
export async function redeployRegistry(
	couchReq: CouchReq,
	dryRun: boolean
): Promise<{ design: 'current' | 'deployed'; masters: ShelterMasterRow[] }> {
	const design = await deployRegistryDesign(couchReq, dryRun);
	const masters = await listShelterMasters(couchReq);
	return { design, masters };
}

import { createHash } from 'node:crypto';
import type { CouchViewDefinition, ShelterViewManifest } from '../domain/view-manifest';

export type ViewLifecycleResponse = { status: number; data: unknown };
export type ViewLifecycleClient = (
	path: string,
	method: string,
	body?: unknown
) => Promise<ViewLifecycleResponse>;

type DesignDocument = {
	_id?: string;
	_rev?: string;
	views?: Record<string, CouchViewDefinition>;
	language?: string;
	[key: string]: unknown;
};

type DesignBody = DesignDocument | ((existing: DesignDocument | null) => DesignDocument);

export type ViewLifecycleMode = 'dry-run' | 'deploy-candidate' | 'promote' | 'verify' | 'write';

export type ViewLifecycleResult = {
	db: string;
	version: number;
	mode: ViewLifecycleMode;
	designName: string;
	targetHash: string;
	status: 'dry-run' | 'candidate-ready' | 'verified' | 'deployed' | 'failed';
	message?: string;
};

const MAX_CONFLICT_RETRIES = 3;

function designPath(name: string): string {
	return `/_design/${encodeURIComponent(name)}`;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

export function hashViews(views: Record<string, CouchViewDefinition>): string {
	return createHash('sha256').update(stableJson(views)).digest('hex');
}

function detail(data: unknown): string {
	const body = (data as { reason?: string; error?: string } | null) ?? {};
	return body.reason ?? body.error ?? 'unknown';
}

function dbPath(db: string): string {
	return `/${encodeURIComponent(db)}`;
}

async function getDesign(
	db: string,
	designName: string,
	request: ViewLifecycleClient
): Promise<DesignDocument | null> {
	const response = await request(`${dbPath(db)}${designPath(designName)}`, 'GET');
	if (response.status === 404) return null;
	if (response.status >= 400) {
		throw new Error(
			`GET ${designName} failed for ${db} (${response.status}): ${detail(response.data)}`
		);
	}
	return response.data as DesignDocument;
}

/**
 * PUT a design document authoritatively.
 *
 * Only `language` is carried forward from whatever already exists at this
 * name — everything else comes from `document`. This is deliberate: earlier
 * revisions merged the ENTIRE existing document in, which let stray top-level
 * fields (`options`, `lib`, anything hand-edited on the server) survive every
 * redeploy forever. CouchDB folds those same fields into the view-group
 * signature (§3.1), so a field `hashViews` doesn't know about could make the
 * deployed signature diverge from the manifest without any redeploy ever
 * detecting it. Writing authoritatively closes that drift path.
 */
async function putDesign(
	db: string,
	designName: string,
	document: DesignBody,
	request: ViewLifecycleClient
): Promise<number> {
	for (let attempt = 1; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
		const existing = await getDesign(db, designName, request);
		const desired = typeof document === 'function' ? document(existing) : document;
		const desiredBody: DesignDocument = { ...desired };
		delete desiredBody._id;
		delete desiredBody._rev;
		const payload: DesignDocument = {
			language: existing?.language ?? 'javascript',
			...desiredBody,
			_id: `_design/${designName}`,
			...(existing?._rev ? { _rev: existing._rev } : {})
		};
		const response = await request(`${dbPath(db)}${designPath(designName)}`, 'PUT', payload);
		if (response.status < 400) return response.status;
		if (response.status !== 409 || attempt === MAX_CONFLICT_RETRIES) {
			throw new Error(
				`PUT ${designName} failed for ${db} (${response.status}): ${detail(response.data)}`
			);
		}
		await new Promise((resolve) => setTimeout(resolve, attempt * 200));
	}
	throw new Error(`PUT ${designName} exhausted conflict retries for ${db}`);
}

async function warmViews(
	db: string,
	designName: string,
	views: Record<string, CouchViewDefinition>,
	request: ViewLifecycleClient
): Promise<void> {
	for (const viewName of Object.keys(views)) {
		// No `stale`/`update` param: CouchDB blocks this request until the view
		// index finishes building, so a 200 here is proof the index is warm — not
		// just that CouchDB accepted the request (§3.6 item 2).
		const response = await request(
			`${dbPath(db)}${designPath(designName)}/_view/${encodeURIComponent(viewName)}?limit=0`,
			'GET'
		);
		if (response.status >= 400) {
			throw new Error(
				`Warm ${designName}/${viewName} failed for ${db} (${response.status}): ${detail(response.data)}`
			);
		}
		const body = response.data as { rows?: unknown } | null;
		if (!body || !Array.isArray(body.rows)) {
			throw new Error(`Warm ${designName}/${viewName} returned an invalid rows payload for ${db}`);
		}
	}
}

async function getViewSignature(
	db: string,
	designName: string,
	request: ViewLifecycleClient
): Promise<string> {
	const response = await request(`${dbPath(db)}${designPath(designName)}/_info`, 'GET');
	if (response.status >= 400) {
		throw new Error(
			`GET ${designName}/_info failed for ${db} (${response.status}): ${detail(response.data)}`
		);
	}
	const signature = (response.data as { view_index?: { signature?: string } } | null)?.view_index
		?.signature;
	if (!signature) throw new Error(`${designName}/_info has no view index signature for ${db}`);
	return signature;
}

async function listSnapshotRows(
	db: string,
	designName: string,
	suffix: '__next_' | '__prev_',
	request: ViewLifecycleClient
): Promise<{ id: string; rev?: string }[]> {
	const prefix = `_design/${designName}${suffix}`;
	const query = new URLSearchParams({
		include_docs: 'true',
		startkey: JSON.stringify(prefix),
		endkey: JSON.stringify(`${prefix}￰`)
	});
	const response = await request(`${dbPath(db)}/_all_docs?${query}`, 'GET');
	if (response.status === 404) return [];
	if (response.status >= 400) {
		throw new Error(`List ${designName}${suffix} failed for ${db} (${response.status})`);
	}
	const rows = (response.data as { rows?: { id: string; doc?: { _rev?: string } }[] } | null)?.rows;
	if (!Array.isArray(rows)) throw new Error(`Invalid snapshot list for ${db}`);
	return rows.map((row) => ({ id: row.id, rev: row.doc?._rev }));
}

async function deleteDesign(
	db: string,
	designId: string,
	rev: string,
	request: ViewLifecycleClient
): Promise<void> {
	const response = await request(
		`${dbPath(db)}/${encodeURIComponent(designId)}?rev=${encodeURIComponent(rev)}`,
		'DELETE'
	);
	if (response.status >= 400 && response.status !== 404) {
		throw new Error(`DELETE ${designId} failed for ${db} (${response.status})`);
	}
}

/**
 * Retire old `__next_`/`__prev_` snapshots and reclaim their index files.
 *
 * Deliberately NOT called from `deployCandidate`/`promoteCandidate` — CR-056
 * §7 item 5 / Stage G require retirement to be its own job with its own
 * dry-run and approval, separate from the deployment that promotes. `keep`
 * lets a caller preserve the current rollback target (`N-1`) while sweeping
 * anything older.
 */
export async function retireSnapshots(
	db: string,
	manifest: ShelterViewManifest,
	request: ViewLifecycleClient,
	options: { keepPrevious?: string; dryRun: boolean }
): Promise<{ removed: string[]; keep: string[] }> {
	const designName = manifest.designName;
	const [nextRows, previousRows] = await Promise.all([
		listSnapshotRows(db, designName, '__next_', request),
		listSnapshotRows(db, designName, '__prev_', request)
	]);
	const keepId = options.keepPrevious ? `_design/${options.keepPrevious}` : undefined;
	const removed: string[] = [];
	const keep: string[] = [];
	for (const row of [...nextRows, ...previousRows]) {
		if (row.id === keepId) {
			keep.push(row.id);
			continue;
		}
		if (!row.rev) continue;
		removed.push(row.id);
		if (!options.dryRun) await deleteDesign(db, row.id, row.rev, request);
	}
	if (!options.dryRun && removed.length > 0) {
		// Index files are reference-counted by signature across every design doc
		// in the database — this only reclaims files no remaining ddoc (including
		// the current stable `_design/app`) points at.
		await request(`${dbPath(db)}/_view_cleanup`, 'POST');
	}
	return { removed, keep };
}

function candidateName(designName: string, targetHash: string): string {
	return `${designName}__next_${targetHash.slice(0, 12)}`;
}

function previousName(designName: string, previousHash: string): string {
	return `${designName}__prev_${previousHash.slice(0, 12)}`;
}

function lifecycleResult(
	db: string,
	manifest: ShelterViewManifest,
	mode: ViewLifecycleMode,
	targetHash: string,
	status: ViewLifecycleResult['status'],
	message?: string
): ViewLifecycleResult {
	return {
		db,
		version: manifest.version,
		mode,
		designName: manifest.designName,
		targetHash,
		status,
		...(message ? { message } : {})
	};
}

/**
 * Stage C+D — bring a candidate design document to the manifest and warm it.
 * Never touches the stable `_design/<name>` that consumers read.
 *
 * `views` is taken from the manifest verbatim — the deployed view set is
 * REPLACED, never merged with what is already there (see `view-manifest.ts`).
 */
export async function deployCandidate(
	db: string,
	manifest: ShelterViewManifest,
	request: ViewLifecycleClient
): Promise<ViewLifecycleResult> {
	const designName = manifest.designName;
	const views = manifest.views;
	const targetHash = hashViews(views);

	const stable = await getDesign(db, designName, request);

	if (!stable) {
		// Nothing is being replaced — there is no consumer relying on this
		// database yet, so writing stable directly (no candidate phase) cannot
		// regress anyone. `promoteCandidate` treats this as already-done.
		await putDesign(
			db,
			designName,
			{ views, tent_view: { version: manifest.version, hash: targetHash, deployment: 'initial' } },
			request
		);
		await warmViews(db, designName, views, request);
		return lifecycleResult(
			db,
			manifest,
			'deploy-candidate',
			targetHash,
			'deployed',
			'initial_deploy'
		);
	}

	if (hashViews(stable.views ?? {}) === targetHash) {
		// Warm even when nothing changed: the document can be current while the
		// index was never built (a fresh replica, or a database nobody queried yet).
		await warmViews(db, designName, views, request);
		return lifecycleResult(
			db,
			manifest,
			'deploy-candidate',
			targetHash,
			'deployed',
			'already_current'
		);
	}

	const candidate = candidateName(designName, targetHash);
	await putDesign(
		db,
		candidate,
		{
			language: stable.language,
			views,
			tent_view: { version: manifest.version, hash: targetHash, source: designName }
		},
		request
	);
	await warmViews(db, candidate, views, request);

	const candidateDoc = await getDesign(db, candidate, request);
	if (!candidateDoc || hashViews(candidateDoc.views ?? {}) !== targetHash) {
		throw new Error(`Candidate verification failed for ${db}`);
	}
	// Touch the signature now so failures surface in the candidate phase, before
	// any shelter has been promoted (Stage C/D must all pass before Stage E).
	await getViewSignature(db, candidate, request);

	return lifecycleResult(
		db,
		manifest,
		'deploy-candidate',
		targetHash,
		'candidate-ready',
		candidate
	);
}

/**
 * Stage E — promote the manifest's candidate to `_design/<name>`.
 *
 * Only safe to call after `deployCandidate` reported `candidate-ready` (or
 * `deployed`/`already_current`, both no-ops here) for every shelter in the
 * release — that barrier lives in the caller (the CI runner), not in this
 * function, because it has to span every shelter database, not one.
 */
export async function promoteCandidate(
	db: string,
	manifest: ShelterViewManifest,
	request: ViewLifecycleClient
): Promise<ViewLifecycleResult> {
	const designName = manifest.designName;
	const views = manifest.views;
	const targetHash = hashViews(views);

	const stable = await getDesign(db, designName, request);

	if (!stable) {
		await putDesign(
			db,
			designName,
			{ views, tent_view: { version: manifest.version, hash: targetHash, deployment: 'initial' } },
			request
		);
		await warmViews(db, designName, views, request);
		return lifecycleResult(db, manifest, 'promote', targetHash, 'deployed', 'initial_deploy');
	}

	if (hashViews(stable.views ?? {}) === targetHash) {
		await warmViews(db, designName, views, request);
		return lifecycleResult(db, manifest, 'promote', targetHash, 'deployed', 'already_current');
	}

	const candidate = candidateName(designName, targetHash);
	const candidateDoc = await getDesign(db, candidate, request);
	if (!candidateDoc || hashViews(candidateDoc.views ?? {}) !== targetHash) {
		throw new Error(
			`Candidate ${candidate} is missing or stale for ${db} — run deploy-candidate first`
		);
	}
	const candidateSignature = await getViewSignature(db, candidate, request);

	const keepPrevious = previousName(designName, hashViews(stable.views ?? {}));
	await putDesign(db, keepPrevious, { ...stable, source_design: designName }, request);

	await putDesign(
		db,
		designName,
		(existing) => ({
			language: existing?.language,
			views,
			tent_view: { version: manifest.version, hash: targetHash, promoted_from: candidate }
		}),
		request
	);
	const promoted = await getDesign(db, designName, request);
	if (!promoted) throw new Error(`Promoted design ${designName} is missing for ${db}`);

	try {
		await warmViews(db, designName, promoted.views ?? {}, request);
		const promotedSignature = await getViewSignature(db, designName, request);
		if (promotedSignature !== candidateSignature) {
			throw new Error(
				`View index signature mismatch for ${db}: candidate=${candidateSignature} promoted=${promotedSignature}`
			);
		}
	} catch (error) {
		const restored = {
			...stable,
			tent_view: stable.tent_view ?? {
				version: manifest.version,
				hash: hashViews(stable.views ?? {}),
				deployment: 'rollback'
			}
		};
		await putDesign(db, designName, restored, request);
		throw error;
	}

	// Only the just-used candidate is removed here. The `__prev_` snapshot this
	// promote just created (and any older ones) are left for `retireSnapshots`
	// — a separate, approved job (CR-056 §7 item 5 / Stage G).
	const candidateRev = candidateDoc._rev;
	if (candidateRev) await deleteDesign(db, `_design/${candidate}`, candidateRev, request);

	return lifecycleResult(db, manifest, 'promote', hashViews(promoted.views ?? {}), 'deployed');
}

/**
 * Convenience wrapper for single-shelter, no-barrier-needed callers (initial
 * shelter provisioning): candidate + promote in one call. The multi-shelter
 * CI runner must NOT use this mode — see `deployCandidate`/`promoteCandidate`.
 */
export async function runViewLifecycle(
	db: string,
	manifest: ShelterViewManifest,
	request: ViewLifecycleClient,
	options: { mode: ViewLifecycleMode }
): Promise<ViewLifecycleResult> {
	const designName = manifest.designName;
	const views = manifest.views;
	const targetHash = hashViews(views);

	if (options.mode === 'dry-run') {
		const current = await getDesign(db, designName, request);
		return lifecycleResult(
			db,
			manifest,
			options.mode,
			targetHash,
			'dry-run',
			current ? `current_hash=${hashViews(current.views ?? {})}` : 'design_missing'
		);
	}

	if (options.mode === 'verify') {
		const stable = await getDesign(db, designName, request);
		if (!stable) throw new Error(`Design ${designName} is missing for ${db}`);
		const currentHash = hashViews(stable.views ?? {});
		if (currentHash !== targetHash) {
			throw new Error(`Hash mismatch for ${db}: expected=${targetHash} actual=${currentHash}`);
		}
		await warmViews(db, designName, views, request);
		return lifecycleResult(db, manifest, options.mode, targetHash, 'verified');
	}

	if (options.mode === 'deploy-candidate') return deployCandidate(db, manifest, request);
	if (options.mode === 'promote') return promoteCandidate(db, manifest, request);

	// mode === 'write': candidate + promote in one call, for single-shelter use.
	const candidateResult = await deployCandidate(db, manifest, request);
	if (candidateResult.status === 'deployed') {
		return { ...candidateResult, mode: 'write' };
	}
	const promoted = await promoteCandidate(db, manifest, request);
	return { ...promoted, mode: 'write' };
}

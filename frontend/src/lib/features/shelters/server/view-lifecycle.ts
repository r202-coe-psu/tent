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
	[key: string]: unknown;
};

type DesignBody = DesignDocument | ((existing: DesignDocument | null) => DesignDocument);

export type ViewLifecycleMode = 'dry-run' | 'write' | 'verify';

export type ViewLifecycleResult = {
	db: string;
	version: number;
	mode: ViewLifecycleMode;
	designName: string;
	targetHash: string;
	status: 'dry-run' | 'verified' | 'deployed' | 'failed';
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
			...(existing ?? {}),
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
		endkey: JSON.stringify(`${prefix}\ufff0`)
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

async function cleanupSnapshots(
	db: string,
	designName: string,
	keepPrevious: string | undefined,
	request: ViewLifecycleClient
): Promise<void> {
	const [nextRows, previousRows] = await Promise.all([
		listSnapshotRows(db, designName, '__next_', request),
		listSnapshotRows(db, designName, '__prev_', request)
	]);
	const keepId = keepPrevious ? `_design/${keepPrevious}` : undefined;
	for (const row of [...nextRows, ...previousRows]) {
		if (row.id === keepId || !row.rev) continue;
		await deleteDesign(db, row.id, row.rev, request);
	}
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
 * Bring one shelter database's design document to the manifest.
 *
 * `views` is taken from the manifest verbatim — the deployed view set is
 * REPLACED, never merged with what is already there (see `view-manifest.ts`).
 * That is what lets `targetHash` be compared against the deployed hash at all.
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

	const stable = await getDesign(db, designName, request);

	if (stable && hashViews(stable.views ?? {}) === targetHash) {
		// Warm even when nothing changed: the document can be current while the
		// index was never built (a fresh replica, or a database nobody queried yet).
		await warmViews(db, designName, views, request);
		return lifecycleResult(db, manifest, options.mode, targetHash, 'deployed', 'already_current');
	}

	if (!stable) {
		await putDesign(
			db,
			designName,
			{
				views,
				tent_view: { version: manifest.version, hash: targetHash, deployment: 'initial' }
			},
			request
		);
		await warmViews(db, designName, views, request);
		return lifecycleResult(db, manifest, options.mode, targetHash, 'deployed', 'initial_deploy');
	}

	let keepPrevious: string | undefined;
	if (stable.views) {
		keepPrevious = previousName(designName, hashViews(stable.views));
		await putDesign(db, keepPrevious, { ...stable, source_design: designName }, request);
	}

	const candidate = candidateName(designName, targetHash);
	await putDesign(
		db,
		candidate,
		{
			...stable,
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
	const candidateSignature = await getViewSignature(db, candidate, request);

	await putDesign(
		db,
		designName,
		(existing) => ({
			...(existing ?? {}),
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

	let message: string | undefined;
	try {
		await cleanupSnapshots(db, designName, keepPrevious, request);
	} catch (error) {
		message = `cleanup_pending: ${error instanceof Error ? error.message : String(error)}`;
	}
	return lifecycleResult(
		db,
		manifest,
		options.mode,
		hashViews(promoted.views ?? {}),
		'deployed',
		message
	);
}

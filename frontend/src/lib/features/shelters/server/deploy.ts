import { SHELTER_VIEW_MANIFEST } from '../domain/view-manifest';
import { runViewLifecycle } from './view-lifecycle';

export type CouchClient = (
	path: string,
	method: string,
	body?: unknown
) => Promise<{ status: number; data: unknown }>;

/**
 * Provision `_design/app` through the same lifecycle the CI/CD runner uses.
 * Sharing one code path keeps initial shelter creation and later redeploys
 * aligned on retry, metadata, warm, and verification behaviour — a shelter
 * created today must end up byte-identical to one the runner has migrated.
 */
export async function deployShelterViewsFn(db: string, request: CouchClient): Promise<number> {
	await runViewLifecycle(db, SHELTER_VIEW_MANIFEST, request, { mode: 'write' });
	return 200;
}

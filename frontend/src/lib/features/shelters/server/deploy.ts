import { getShelterViewModule } from '../domain/view-modules';
import { runViewLifecycle } from './view-lifecycle';

export type CouchClient = (
	path: string,
	method: string,
	body?: unknown
) => Promise<{ status: number; data: unknown }>;

/**
 * Provision the Dashboard Design Document through the same lifecycle used by
 * the CI/CD runner. This keeps initial shelter creation and redeploys aligned
 * on retry, metadata, warm, and verification behavior.
 */
export async function deployShelterViewsFn(db: string, request: CouchClient): Promise<number> {
	await runViewLifecycle(db, getShelterViewModule('dashboard'), request, { mode: 'write' });
	return 200;
}

import { SHELTER_VIEW_MANIFEST } from '../domain/view-manifest';

export type ViewDeploymentStatus =
	{ state: 'missing' } | { state: 'stale'; deployedVersion: number | null } | { state: 'current' };

/**
 * `_design/app` carries `tent_view.version` once deployed through the shared
 * lifecycle (view-lifecycle.ts). A consumer that trusts view rows without
 * checking this can silently misread them across a version boundary — e.g.
 * `demographics_by_age` changed its key from an age-bucket string to a raw
 * `birth_year` number between versions, and an app build on one side reading
 * a `_design/app` on the other side of that change gets rows that parse
 * without error but mean nothing (CR-056 §11 item 6: that must never collapse
 * to `0`). Every dashboard/public endpoint reading these views must check
 * this before trusting rows, not just check for a 404.
 */
export async function checkViewDeployment(
	db: string,
	request: (path: string, method: string) => Promise<{ status: number; data: unknown }>
): Promise<ViewDeploymentStatus> {
	const res = await request(
		`/${encodeURIComponent(db)}/_design/${SHELTER_VIEW_MANIFEST.designName}`,
		'GET'
	);
	if (res.status === 404) return { state: 'missing' };
	if (res.status >= 400) return { state: 'missing' };
	const deployedVersion =
		(res.data as { tent_view?: { version?: number } } | null)?.tent_view?.version ?? null;
	if (deployedVersion !== SHELTER_VIEW_MANIFEST.version) return { state: 'stale', deployedVersion };
	return { state: 'current' };
}

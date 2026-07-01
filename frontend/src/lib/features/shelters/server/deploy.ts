import { SHELTER_DASHBOARD_VIEWS } from '../domain/views';

export type CouchClient = (
	path: string,
	method: string,
	body?: unknown
) => Promise<{ status: number; data: unknown }>;

/**
 * Deploy CouchDB Design Documents (Views) for a shelter database.
 * Merges with any existing views in `_design/app` to avoid overwriting them.
 */
export async function deployShelterViewsFn(db: string, request: CouchClient): Promise<number> {
	const appDesign: {
		_id: string;
		_rev?: string;
		views: Record<string, { map: string; reduce: string }>;
	} = JSON.parse(JSON.stringify(SHELTER_DASHBOARD_VIEWS));

	// Read-Modify-Write: fetch existing _rev to avoid 409 Conflict (skill §3).
	// Also merge existing views so we don't drop views deployed by other modules.
	const existing = await request(`/${db}/_design/app`, 'GET');
	if (existing.status === 200) {
		const existingData = existing.data as {
			_rev: string;
			views?: Record<string, { map: string; reduce: string }>;
		};
		appDesign['_rev'] = existingData._rev;
		appDesign.views = {
			...(existingData.views || {}),
			...appDesign.views
		};
	}

	const res = await request(`/${db}/_design/app`, 'PUT', appDesign);
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Failed to deploy _design/app to ${db} (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return res.status;
}

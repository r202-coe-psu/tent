import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError } from '$lib/server/couch-admin';
import { findMasterByCode, migrate } from '$lib/server/shelters.admin';

export const prerender = false;

/**
 * GET /public/v1/shelters/{code}/risk
 * Public endpoint (no auth) — returns section 5 fields for EOC real-time consumption.
 *
 * PII redaction: this endpoint exposes ONLY the risk section + operation_status.
 * It never returns `contact`, `phone`, `facilities` counts, or any evacuee data
 * (per security-rbac-bestpractices §3). Aggregate public metrics live in a
 * separate `/public/metrics` endpoint.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const code = params.code;
		if (!code) return error(400, { message: 'Missing code' });

		const master = await findMasterByCode(code);
		if (!master) return error(404, { message: `Shelter "${code}" not found` });

		const migrated = migrate(master);

		return json({
			code: migrated.code,
			name: migrated.name,
			operation_status: migrated.operation_status,
			risk: {
				elevation_m: migrated.risk?.elevation_m ?? null,
				entrance_description: migrated.risk?.entrance_description ?? null,
				constraints: migrated.risk?.constraints ?? null
			},
			updated_at: migrated.updated_at
		});
	} catch (e) {
		return serviceError(e);
	}
};

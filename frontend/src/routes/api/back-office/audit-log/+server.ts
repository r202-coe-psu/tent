import { json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import type { RequestHandler } from './$types';
import { authorizeSession, ServiceError, serviceOrHttpError } from '$lib/server/couch-admin';
import { isShelterManager, shelterCodesFromRoles } from '$lib/auth/roles';
import { parseAuditLogQuery, type AuditLogQuery } from '$lib/features/audit-log/server';
import { queryAuditLog } from '$lib/server/audit-log';

export const prerender = false;

function scopeQuery(
	query: AuditLogQuery,
	caller: { roles: readonly string[]; isSA: boolean }
): AuditLogQuery {
	if (caller.isSA) return query;
	const managed = shelterCodesFromRoles(caller.roles).filter((code) =>
		isShelterManager(caller.roles, code)
	);
	if (managed.length === 0) {
		throw new ServiceError('FORBIDDEN', 'Requires system_admin or shelter_manager');
	}
	if (query.shelter_code) {
		if (!managed.includes(query.shelter_code)) {
			throw new ServiceError(
				'FORBIDDEN',
				`Caller may not read the audit log of ${query.shelter_code}`
			);
		}
		return query;
	}
	if (managed.length > 1) throw new ServiceError('VALIDATION', 'shelter_code is required');
	return { ...query, shelter_code: managed[0] };
}

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeSession(request.headers.get('cookie'));
		let query: AuditLogQuery;
		try {
			query = parseAuditLogQuery(url.searchParams);
		} catch (e) {
			if (e instanceof ZodError) {
				throw new ServiceError('VALIDATION', e.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
			}
			throw e;
		}
		const page = await queryAuditLog(scopeQuery(query, caller));
		return json(page, { headers: { 'cache-control': 'no-store, max-age=0' } });
	} catch (e) {
		return serviceOrHttpError(e);
	}
};

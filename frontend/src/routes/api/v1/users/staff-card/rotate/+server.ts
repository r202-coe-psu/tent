import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { rotateStaffCard } from '$lib/server/staff-card-service';
import { readUserDocForLink } from '$lib/server/user-service';
import { recordAuditedWrites } from '$lib/server/audit-log';
import { AUDIT_EVENTS, auditShelterCodesFromRoles } from '$lib/features/audit-log/server';

export const prerender = false;

/** POST { name } — Admin issues a new permanent QR for a staff member, invalidating the old one */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		const body = (await request.json().catch(() => ({}))) as { name?: unknown };
		const name = typeof body.name === 'string' ? body.name.trim() : '';

		if (!name) {
			throw new ServiceError('VALIDATION', 'name is required');
		}

		const card = await rotateStaffCard(caller, name);
		const user = await readUserDocForLink(name).catch(() => null);
		await recordAuditedWrites(
			{
				actor: caller.name,
				event: AUDIT_EVENTS.userStaffCardRotated,
				action: 'update',
				entityType: 'user',
				entityId: name,
				label: user?.display_name ?? null
			},
			auditShelterCodesFromRoles(user?.roles)
		);
		return json(card, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		return serviceError(e);
	}
};

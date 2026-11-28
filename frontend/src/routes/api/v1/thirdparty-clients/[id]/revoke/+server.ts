/**
 * SA-only BFF — revoke a third-party OAuth2 client via FastAPI
 * `POST /v1/admin/thirdparty-clients/{id}/revoke` (EXT-001, ADR 0002).
 */
import type { RequestHandler } from './$types';
import { recordProxiedWrite } from '$lib/server/audit-log';
import { AUDIT_EVENTS } from '$lib/features/audit-log/server';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders, proxyFastapiJson } from '$lib/server/fastapi';

export const prerender = false;

/** POST — revoke client by id. */
export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		if (!caller.isSA) {
			throw new ServiceError('FORBIDDEN', 'Only system admins can manage third-party clients');
		}

		const id = typeof params.id === 'string' ? params.id.trim() : '';
		if (!id) throw new ServiceError('VALIDATION', 'id is required');

		const res = await fetch(
			`${fastapiBaseUrl()}/v1/admin/thirdparty-clients/${encodeURIComponent(id)}/revoke`,
			{
				method: 'POST',
				headers: fastapiServiceHeaders({ Accept: 'application/json' })
			}
		);
		await recordProxiedWrite(res, {
			actor: caller.name,
			event: AUDIT_EVENTS.thirdpartyClientUpdated,
			action: 'status_change',
			entityType: 'thirdparty_client',
			entityId: id,
			shelterCode: null,
			reason: 'revoked'
		});
		return proxyFastapiJson(res);
	} catch (e) {
		return serviceError(e);
	}
};

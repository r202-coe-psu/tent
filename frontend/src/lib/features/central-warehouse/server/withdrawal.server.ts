/**
 * Central-warehouse (M6) withdrawal orchestration for the BFF (draft CR M6 §2, §6).
 *
 * Server-only. Reads the shelter master with admin rights, builds the RES-005 payload on the
 * server (the browser never picks the requester or destination), and calls FastAPI. Withdrawals
 * live in Mongo (FastAPI) only — there is no CouchDB doc, and this never creates a donation.
 */
import { findMasterByCode } from '$lib/server/shelters.admin';
import { getCurrentUserProfile } from '$lib/server/user-service';
import { IntegrationError, integrationRequest } from '$lib/server/integrations';
import type { Caller } from '$lib/server/couch-admin';
import { ulid } from '$lib/db/ulid';
import {
	M6PayloadError,
	buildM6WithdrawalPayload,
	cancelBodySchema,
	externalRefFor,
	withdrawalCreateInputSchema,
	type M6Actor
} from '../domain/central-warehouse.payload';
import type { WithdrawalView } from '../domain/central-warehouse.schema';

export type WithdrawalContext = { caller: Caller; shelterCode: string };

/** Display name for M6's `contact_name` / `actor.name`; the username when no profile is found. */
async function resolveActor(caller: Caller): Promise<M6Actor> {
	const username = caller.name;
	try {
		const profile = await getCurrentUserProfile(username);
		return { name: profile.display_name?.trim() || username, username };
	} catch {
		return { name: username, username };
	}
}

function validation(message: string): IntegrationError {
	return new IntegrationError(422, 'VALIDATION', message);
}

/**
 * Send one withdrawal request. `external_ref` is generated here (`TENT-{shelter}-{ulid}`).
 * @throws {IntegrationError} 422 `VALIDATION` / `SHELTER_LOCATION_MISSING`, 404 `SHELTER_NOT_FOUND`,
 * or FastAPI's mapped M6 error.
 */
export async function createWithdrawal(
	ctx: WithdrawalContext,
	body: unknown,
	newId: () => string = ulid
): Promise<WithdrawalView> {
	const parsed = withdrawalCreateInputSchema.safeParse(body);
	if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');

	const shelter = await findMasterByCode(ctx.shelterCode);
	if (!shelter) throw new IntegrationError(404, 'SHELTER_NOT_FOUND', 'ไม่พบศูนย์พักพิงนี้');

	const actor = await resolveActor(ctx.caller);
	try {
		const payload = buildM6WithdrawalPayload({
			input: parsed.data,
			shelter: { code: shelter.code, name: shelter.name, location: shelter.location },
			contactName: actor.name,
			actor,
			externalRef: externalRefFor(shelter.code, newId())
		});
		return await integrationRequest<WithdrawalView>(
			'POST',
			'/v1/integrations/m6/withdrawals',
			payload
		);
	} catch (e) {
		if (e instanceof M6PayloadError) throw new IntegrationError(422, e.code, e.message);
		throw e;
	}
}

/** Cancel a pending request (RES-008) on behalf of the signed-in user. */
export async function cancelWithdrawal(
	ctx: WithdrawalContext,
	requestCode: string,
	body: unknown
): Promise<WithdrawalView> {
	const parsed = cancelBodySchema.safeParse(body);
	if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
	const actor = await resolveActor(ctx.caller);
	return integrationRequest<WithdrawalView>(
		'POST',
		`/v1/integrations/m6/withdrawals/${encodeURIComponent(requestCode)}/cancel`,
		{ shelter_code: ctx.shelterCode, reason: parsed.data.reason, actor }
	);
}

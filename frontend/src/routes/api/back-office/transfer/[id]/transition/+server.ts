/* eslint-disable no-restricted-imports */
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { authorizeTransfer, resolveShelterCode, handleEndpointError } from '../../_auth';
import {
	TransferServerRepository,
	TransferServerRepositoryError
} from '$lib/features/operations/data/transfer.server-repository';
import { transferStatusSchema, receivedItemSchema } from '$lib/features/operations/server';

export const prerender = false;

const transitionBodySchema = z.object({
	to: transferStatusSchema,
	receivedItems: z.array(receivedItemSchema).optional(),
	notes: z.string().trim().max(2000).optional(),
	// CR-089 — accepted here, required by the domain schema of the matching transition. Kept
	// optional at the edge so one body shape serves every transition; the domain rejects a
	// transition that arrives without the field it needs.
	driver_name: z.string().trim().max(200).optional(),
	vehicle_plate: z.string().trim().max(50).optional(),
	cancel_reason: z.string().trim().max(2000).optional(),
	dispute_reason: z.string().trim().max(2000).optional()
});

/**
 * PATCH /api/back-office/transfer/[id]/transition
 * Transition the transfer state (`shipped`/`received`/`cancelled`/`disputed`, and `requested`
 * for a CR-089 resume) with conflict (409) retry.
 * Same 3-attempt, fixed-50ms-delay retry loop as `referral/[id]/transition/+server.ts`.
 */
export const PATCH: RequestHandler = async ({ request, params, url }) => {
	try {
		const caller = await authorizeTransfer(request.headers.get('cookie'));
		const id = params.id;
		if (!id) {
			return json({ error: 'Missing ID parameter' }, { status: 400 });
		}

		const shelterCode = resolveShelterCode(caller, url.searchParams.get('shelter_code'));

		const body = await request.json().catch(() => ({}));
		const parsed = transitionBodySchema.safeParse(body);
		if (!parsed.success) {
			return json({ error: 'Validation failed', details: parsed.error.format() }, { status: 422 });
		}

		const { to, receivedItems, notes, driver_name, vehicle_plate, cancel_reason, dispute_reason } =
			parsed.data;

		const repo = new TransferServerRepository('central_ops', shelterCode);

		const MAX_RETRIES = 3;
		let lastError: { message?: string } | null = null;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				const updated = await repo.transition(id, to, caller.name, shelterCode, {
					receivedItems,
					notes,
					driver_name,
					vehicle_plate,
					cancel_reason,
					dispute_reason
				});
				return json(updated);
			} catch (e: unknown) {
				const err = e as { status?: number; message?: string };
				const isConflict =
					err.status === 409 ||
					err.message?.includes('409') ||
					err.message?.includes('conflict') ||
					err.message?.includes('Conflict');

				if (isConflict) {
					lastError = err;
					await new Promise((resolve) => setTimeout(resolve, 50));
					continue;
				}
				throw e;
			}
		}

		return json(
			{
				error: `Conflict: transition failed after ${MAX_RETRIES} attempts`,
				details: lastError?.message
			},
			{ status: 409 }
		);
	} catch (e: unknown) {
		// dispatchTransfer/receiveTransfer/cancelTransfer throw a plain Error for a domain
		// validation failure (invalid status transition, over-receipt) — not a
		// TransferServerRepositoryError (which already carries its own HTTP status and goes
		// through handleEndpointError below). Map any such plain Error to 422, same as
		// referral's "Invalid referral transition" catch.
		if (e instanceof Error && !(e instanceof TransferServerRepositoryError)) {
			return json({ error: e.message }, { status: 422 });
		}
		return handleEndpointError(e, 'Transfer API Transition PATCH');
	}
};

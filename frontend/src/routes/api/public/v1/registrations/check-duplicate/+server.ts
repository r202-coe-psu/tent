import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { isShelterCancelled, resolveOperationStatus } from '$lib/features/shelters/server';
import { listShelterMasters } from '$lib/server/shelters.admin';
import { findConflictingHold } from '$lib/features/public-register/booking-gate.server';
import { unassignedRegistrationRemote } from '$lib/features/unassigned-registration';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };

const checkDuplicateSchema = z
	.object({
		national_id: z.string().optional().nullable(),
		phone: z.string().optional().nullable()
	})
	.refine((data) => Boolean(data.national_id?.trim() || data.phone?.trim()), {
		message: 'At least one of national_id or phone must be provided'
	});

/**
 * POST /api/public/v1/registrations/check-duplicate
 *
 * Public duplicate check for citizen pre-registration.
 * Privacy & PDPA Guarantees:
 * - NEVER returns evacuee names, addresses, stay details, or shelter names.
 * - Only returns boolean `{ success: true, duplicate: boolean, field: 'national_id' | 'phone' | null }`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const payload = await request.json().catch(() => null);
	const parsed = checkDuplicateSchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}

	const rawNationalId = parsed.data.national_id?.trim() ?? '';

	const cleanNationalId = rawNationalId.replace(/\D/g, '');

	const checkCard = cleanNationalId.length === 13 ? cleanNationalId : undefined;
	// Phone is accepted but never checked: shared phones are allowed on public pre-register (#1049)
	if (!checkCard) {
		return json({ success: true, duplicate: false, field: null }, { headers: noStore });
	}

	// 1. Query shelters for active conflicting holds
	try {
		const rawMasters = await listShelterMasters().catch(() => []);
		// Shelters hidden via feature_flags.public_visible stay in scope on purpose: an existing
		// hold there is still real, so a duplicate booking must keep colliding (CR-251).
		const masters = rawMasters.filter(
			(m) => resolveOperationStatus(m) !== 'closed' && !isShelterCancelled(m)
		);
		for (const master of masters) {
			const conflict = await findConflictingHold(master.code, {
				cardNumber: checkCard
			});

			if (conflict) {
				return json({ success: true, duplicate: true, field: 'national_id' }, { headers: noStore });
			}
		}
	} catch {
		// Tolerant fallback — do not break form flow if Couch lookup fails
	}

	// 2. Query Central Unassigned Pool
	if (checkCard) {
		try {
			const poolRes = await unassignedRegistrationRemote.searchOpen(checkCard);
			if (poolRes && poolRes.results && poolRes.results.length > 0) {
				return json({ success: true, duplicate: true, field: 'national_id' }, { headers: noStore });
			}
		} catch {
			// Pool error tolerant fallback
		}
	}

	return json({ success: true, duplicate: false, field: null }, { headers: noStore });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { registerLookupIpLimiter } from '$lib/server/security/rate-limiter';
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
 * Rate-limited public duplicate check for citizen pre-registration.
 * Privacy & PDPA Guarantees:
 * - NEVER returns evacuee names, addresses, stay details, or shelter names.
 * - Only returns boolean `{ success: true, duplicate: boolean, field: 'national_id' | 'phone' | null }`.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	if (!registerLookupIpLimiter.check(ip)) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429, headers: noStore });
	}

	const payload = await request.json().catch(() => null);
	const parsed = checkDuplicateSchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}

	const rawNationalId = parsed.data.national_id?.trim() ?? '';
	const rawPhone = parsed.data.phone?.trim() ?? '';

	const cleanNationalId = rawNationalId.replace(/\D/g, '');
	const cleanPhone = rawPhone.replace(/\D/g, '');

	const checkCard = cleanNationalId.length === 13 ? cleanNationalId : undefined;
	const checkPhone = cleanPhone.length >= 9 && cleanPhone.length <= 10 ? cleanPhone : undefined;

	if (!checkCard && !checkPhone) {
		return json({ success: true, duplicate: false, field: null }, { headers: noStore });
	}

	// 1. Query shelters for active conflicting holds
	try {
		const masters = await listShelterMasters().catch(() => []);
		for (const master of masters) {
			const conflict = await findConflictingHold(master.code, {
				cardNumber: checkCard,
				phone: checkPhone
			});

			if (conflict) {
				let matchedField: 'national_id' | 'phone' = 'national_id';
				if (checkPhone && conflict.phone?.replace(/\D/g, '') === checkPhone) {
					matchedField = 'phone';
				}
				return json({ success: true, duplicate: true, field: matchedField }, { headers: noStore });
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

	if (checkPhone) {
		try {
			const poolRes = await unassignedRegistrationRemote.searchOpen(checkPhone);
			if (poolRes && poolRes.results && poolRes.results.length > 0) {
				return json({ success: true, duplicate: true, field: 'phone' }, { headers: noStore });
			}
		} catch {
			// Pool error tolerant fallback
		}
	}

	return json({ success: true, duplicate: false, field: null }, { headers: noStore });
};

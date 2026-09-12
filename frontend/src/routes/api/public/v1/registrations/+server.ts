import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import type { RequestHandler } from './$types';

import {
	bookingCodeFrom,
	isCaptchaKeyConfigured,
	isForecastCapacityExceeded,
	publicBookingInputSchema,
	executePublicFamilyRegistration
} from '$lib/features/public-register/server';
import {
	findConflictingHold,
	readForecastOccupancy
} from '$lib/features/public-register/booking-gate.server';
import {
	unifiedRegistrationInputSchema,
	type UnifiedRegistrationInput
} from '$lib/features/people/server';
import { isShelterBookable } from '$lib/features/shelters/server';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { registerIpLimiter, registerPhoneLimiter } from '$lib/server/security/rate-limiter';
import { findMasterByCode } from '$lib/server/shelters.admin';

// Never prerendered — runs on the Node server at runtime.
export const prerender = false;

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

const noStore = { 'Cache-Control': 'no-store' };

/**
 * POST /api/public/v1/registrations — public shelter booking (#254 / CR-070 / T-71).
 *
 * Anonymous write path. The browser never holds a credential: this handler
 * validates, then writes via `executePublicFamilyRegistration` using the
 * roleless public writer. Writes 1 Household + N Evacuees minted at
 * `pre_registered` and `registered_via: 'web'`.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const payload = await request.json().catch(() => null);
	if (!payload || typeof payload !== 'object') {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: { formErrors: ['Invalid JSON payload'] } },
			{ status: 422, headers: noStore }
		);
	}

	let shelterCode: string;
	let phone: string;
	let nationalId: string | null;
	let captchaToken: string | undefined;
	let unifiedInput: UnifiedRegistrationInput;

	// Check if this is the shared unified payload shape ({ members, household })
	if ('household' in payload && payload.household && typeof payload.household === 'object') {
		const publicUnifiedSchema = z
			.object({
				shelter_code: z.string().trim().min(1, 'กรุณาระบุศูนย์พักพิง'),
				captchaToken: z.string().optional(),
				disclaimerAcknowledged: z.boolean().optional(),
				members: unifiedRegistrationInputSchema.shape.members,
				household: unifiedRegistrationInputSchema.shape.household
			})
			.superRefine((data, ctx) => {
				const head = data.members[0];
				const headPhone = head?.phone?.trim();
				if (!headPhone || !/^0\d{8,9}$/.test(headPhone.replace(/[-\s]/g, ''))) {
					ctx.addIssue({
						code: 'custom',
						path: ['members', 0, 'phone'],
						message: 'กรุณากรอกเบอร์โทรศัพท์ 10 หลักของผู้ติดต่อหลัก'
					});
				}
			});

		const parsed = publicUnifiedSchema.safeParse(payload);
		if (!parsed.success) {
			return json(
				{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
				{ status: 422, headers: noStore }
			);
		}

		shelterCode = parsed.data.shelter_code;
		captchaToken = parsed.data.captchaToken;
		phone = parsed.data.members[0].phone!.trim();
		nationalId = parsed.data.members[0].person_id?.number?.trim() || null;
		unifiedInput = {
			members: parsed.data.members,
			household: parsed.data.household
		};
	} else {
		// Legacy booking shape (for backward compatibility with tests)
		const parsed = publicBookingInputSchema.safeParse(payload);
		if (!parsed.success) {
			return json(
				{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
				{ status: 422, headers: noStore }
			);
		}

		const legacy = parsed.data;
		shelterCode = legacy.shelter_code;
		captchaToken = legacy.captchaToken;
		phone = legacy.phone;
		nationalId = legacy.national_id ?? null;

		const LEGACY_PET_SPECIES = new Set(['dog', 'cat', 'other']);
		const pets = legacy.pets.map((pet) => {
			const isBird = pet.species === 'bird';
			const isKnown = LEGACY_PET_SPECIES.has(pet.species);
			const species = (isKnown ? pet.species : 'other') as 'dog' | 'cat' | 'other';
			const rawNotes = [pet.name, pet.condition, pet.notes]
				.map((s) => s?.trim())
				.filter(Boolean)
				.join(' | ');
			const notes = isBird
				? rawNotes || 'นก'
				: isKnown
					? rawNotes || undefined
					: [rawNotes, `ชนิด: ${pet.species}`].filter(Boolean).join(' — ') || undefined;

			return {
				species,
				count: 1,
				notes,
				has_cage: pet.has_cage
			};
		});

		const members = legacy.members.map((m, idx) => {
			const isContact = idx === 0;
			const memberPhone = m.phone ?? (isContact ? legacy.phone : null);
			const personId = m.person_id?.number
				? { cardType: m.person_id.cardType, number: m.person_id.number }
				: isContact && legacy.national_id
					? { cardType: 'national_id' as const, number: legacy.national_id }
					: m.person_id?.cardType === 'anonymous'
						? { cardType: 'anonymous' as const, number: m.person_id.number || undefined }
						: undefined;

			return {
				first_name: m.first_name,
				last_name: m.last_name ?? '',
				gender: m.gender,
				phone: memberPhone,
				...(personId ? { person_id: personId } : {}),
				country: m.country || 'THAILAND',
				vulnerable_groups: m.vulnerable_groups || [],
				special_needs: m.special_needs || [],
				...(m.birth_year !== undefined ? { birth_year: m.birth_year } : {}),
				...(m.age !== undefined ? { age: m.age } : {})
			};
		});

		unifiedInput = {
			members,
			household: {
				housing_type: legacy.address.housing_type ?? null,
				residence_landmark: legacy.address.residence_landmark ?? null,
				address_no:
					legacy.address.housing_type === 'homeless' ? null : (legacy.address.address_no ?? null),
				village_no: legacy.address.village_no ?? null,
				subdistrict: legacy.address.subdistrict ?? null,
				district: legacy.address.district ?? null,
				province: legacy.address.province ?? null,
				postal_code: legacy.address.postal_code ?? null,
				pets,
				vehicles: legacy.vehicles ?? [],
				assets: legacy.asset_description
					? { description: legacy.asset_description, image_url: null }
					: null
			}
		};
	}

	// 2. Rate limit on both axes before doing any work.
	const ip = getClientAddress();
	if (!registerIpLimiter.check(ip) || !registerPhoneLimiter.check(phone)) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429, headers: noStore });
	}

	// 3. CAPTCHA verification.
	if (!isCaptchaKeyConfigured(env.SECRET_RECAPTCHA_KEY)) {
		if (!dev) {
			console.error('SECRET_RECAPTCHA_KEY is missing or is a placeholder!');
			return json(
				{ success: false, error: 'SERVER_MISCONFIGURED' },
				{ status: 500, headers: noStore }
			);
		}
		console.warn('[dev] SECRET_RECAPTCHA_KEY not configured — skipping CAPTCHA verification');
	} else {
		if (!captchaToken) {
			return json({ success: false, error: 'CAPTCHA_REQUIRED' }, { status: 400, headers: noStore });
		}
		if (!(await captchaProvider.verifyToken(captchaToken, ip, 'register'))) {
			return json({ success: false, error: 'CAPTCHA_FAILED' }, { status: 403, headers: noStore });
		}
	}

	// 4. Trust nothing from the browser about the shelter.
	const master = await findMasterByCode(shelterCode);
	if (!master) {
		return json({ success: false, error: 'SHELTER_NOT_FOUND' }, { status: 404, headers: noStore });
	}
	if (!isShelterBookable(master)) {
		return json({ success: false, error: 'SHELTER_CLOSED' }, { status: 409, headers: noStore });
	}

	// 4b. Duplicate-hold prevention (CR-112)
	const conflict = await findConflictingHold(shelterCode, {
		phone,
		cardNumber: nationalId
	});
	if (conflict) {
		return json({ success: false, error: 'DUPLICATE_HOLD' }, { status: 409, headers: noStore });
	}

	// 4c. Forecast capacity gate (CR-112)
	const capacity = typeof master.capacity === 'number' ? master.capacity : 0;
	const forecast = await readForecastOccupancy(shelterCode);
	if (
		forecast !== null &&
		isForecastCapacityExceeded(forecast, capacity, unifiedInput.members.length)
	) {
		return json({ success: false, error: 'CAPACITY_EXCEEDED' }, { status: 409, headers: noStore });
	}

	// 5. Execute CouchDB write via dedicated public executor (#254)
	let writeResult: Awaited<ReturnType<typeof executePublicFamilyRegistration>>;
	try {
		writeResult = await executePublicFamilyRegistration(unifiedInput, {
			shelterCode,
			createdBy: 'public'
		});
	} catch {
		return json({ success: false, error: 'WRITE_FAILED' }, { status: 502, headers: noStore });
	}

	const { household, evacuees } = writeResult;

	// 6. Ticket payload — no person_id, no medical, no full phone (Public DoD).
	return json(
		{
			success: true,
			code: bookingCodeFrom(evacuees[0]._id),
			shelter_code: shelterCode,
			shelter_name: master.name,
			first_name: evacuees[0].first_name,
			member_count: evacuees.length,
			pet_count: (household.pets ?? []).length,
			status: evacuees[0].current_stay.status,
			booked_at: evacuees[0].created_at
		},
		{ status: 201, headers: noStore }
	);
};

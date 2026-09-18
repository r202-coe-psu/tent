import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { housingTypeSchema } from '$lib/features/people/server';
import {
	findShelterResidenceMatches,
	findUnassignedResidenceMatches,
	findUniversalResidenceMatches
} from '$lib/features/public-register/residence-match.server';

export const prerender = false;

const noStore = { 'Cache-Control': 'no-store' };

const residenceMatchBodySchema = z
	.object({
		shelter_code: z.string().trim().min(1).optional(),
		unassigned: z.boolean().optional(),
		housing_type: housingTypeSchema.nullable().optional(),
		residence_landmark: z.string().trim().nullable().optional(),
		address_no: z.string().trim().nullable().optional(),
		village_no: z.string().trim().nullable().optional(),
		subdistrict: z.string().trim().nullable().optional(),
		district: z.string().trim().nullable().optional(),
		province: z.string().trim().nullable().optional(),
		postal_code: z.string().trim().nullable().optional(),
		phone: z.string().trim().nullable().optional()
	})
	.superRefine((value, ctx) => {
		const hasShelter = Boolean(value.shelter_code?.trim());
		const unassigned = value.unassigned === true;
		if (hasShelter === unassigned) {
			ctx.addIssue({
				code: 'custom',
				message: 'ระบุ shelter_code หรือ unassigned=true อย่างใดอย่างหนึ่ง'
			});
		}
	});

/**
 * POST /api/public/v1/households/residence-match
 * Returns signed match_token + non-PII chips only (no names / phones / member lists).
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	const raw = await request.json().catch(() => null);
	const parsed = residenceMatchBodySchema.safeParse(raw);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}

	const query = {
		housing_type: parsed.data.housing_type ?? null,
		residence_landmark: parsed.data.residence_landmark ?? null,
		address_no: parsed.data.address_no ?? null,
		village_no: parsed.data.village_no ?? null,
		subdistrict: parsed.data.subdistrict ?? null,
		district: parsed.data.district ?? null,
		province: parsed.data.province ?? null,
		postal_code: parsed.data.postal_code ?? null,
		phone: parsed.data.phone ?? null
	};

	const matches = parsed.data.unassigned
		? await findUniversalResidenceMatches(query, fetch)
		: await findShelterResidenceMatches(parsed.data.shelter_code!.trim(), query);

	return json({ success: true, matches }, { headers: noStore });
};

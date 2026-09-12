import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findMasterByCode } from '$lib/server/shelters.admin';

export const prerender = false;

/**
 * GET /api/public/v1/config/shelter-policy?shelter=<code> — feature flags and
 * policy rules for the shelter (pets, luggage/assets, parking/vehicles).
 *
 * Used by the public booking form to conditionally render sections according
 * to the shelter's configuration, and generate safety disclaimers.
 */
export const GET: RequestHandler = async ({ url }) => {
	const shelterCode = url.searchParams.get('shelter')?.trim() || null;
	if (!shelterCode) {
		return json(
			{
				feature_flags: { allow_pets: false, allow_assets: false, allow_vehicles: false },
				admission_policy: null,
				luggage_policy: null,
				parking_policy: null
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	}

	try {
		const master = await findMasterByCode(shelterCode);
		if (!master) {
			return json(
				{
					feature_flags: { allow_pets: false, allow_assets: false, allow_vehicles: false },
					admission_policy: null,
					luggage_policy: null,
					parking_policy: null
				},
				{ status: 404, headers: { 'Cache-Control': 'no-store' } }
			);
		}

		const allowPets =
			master.feature_flags?.allow_pets ??
			master.admission_policy?.pet_policy?.policy === 'conditional';
		const allowVehicles =
			master.feature_flags?.allow_vehicles ?? master.parking_policy?.availability === 'available';
		const allowAssets =
			master.feature_flags?.allow_assets ?? master.luggage_policy?.limitation != null;

		return json(
			{
				code: master.code,
				name: master.name,
				feature_flags: {
					allow_pets: allowPets,
					allow_assets: allowAssets,
					allow_vehicles: allowVehicles
				},
				admission_policy: master.admission_policy ?? null,
				luggage_policy: master.luggage_policy ?? null,
				parking_policy: master.parking_policy ?? null
			},
			{
				headers: { 'Cache-Control': 'public, max-age=300' }
			}
		);
	} catch (e) {
		console.warn('shelter-policy lookup failed:', e);
		return json(
			{
				feature_flags: { allow_pets: false, allow_assets: false, allow_vehicles: false },
				admission_policy: null,
				luggage_policy: null,
				parking_policy: null
			},
			{ status: 500, headers: { 'Cache-Control': 'no-store' } }
		);
	}
};

/**
 * Dev-only seed helper — creates the initial SOP master profile in the catalog DB.
 * Idempotent: skips if any active master profile already exists.
 *
 * Usage (browser console or a dev route):
 *   import { seedDefaultSopProfile } from '$lib/features/sop-ratios/data/sop-ratio.seed';
 *   await seedDefaultSopProfile();
 */
import { createInitialProfile } from '../domain/sop-ratio';
import { sopMasterRepository } from './sop-ratio.pouch';

export async function seedDefaultSopProfile(): Promise<void> {
	const masterRepo = sopMasterRepository();
	const existing = await masterRepo.listActive();
	if (existing.length > 0) {
		console.info('[seed] SOP profile already exists — skipped');
		return;
	}

	const { profile, audit } = createInitialProfile(
		'sop_profile',
		'SOP มาตรฐาน',
		{
			water_l_per_person_day: 15,
			rice_g_per_person_meal: 150,
			toilet_per_person: 0.05
		},
		{ createdBy: 'seed' }
	);

	await masterRepo.createVersion(null, profile, audit);
	console.info('[seed] SOP profile created:', profile._id);
}

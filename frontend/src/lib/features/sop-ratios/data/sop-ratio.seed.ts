/**
 * Dev-only seed helper — creates the initial SOP ratio profile in the shelter DB.
 * Run once per fresh DB. Safe to re-run (409 conflict = already seeded, ignored).
 *
 * Usage (browser console or a dev route):
 *   import { seedDefaultSopProfile } from '$lib/features/sop-ratios/data/sop-ratio.seed';
 *   await seedDefaultSopProfile();
 */
import { namedLocalDb } from '$lib/db/pouch';
import { SHELTER_DB, SHELTER_CODE } from '$lib/db/shelter';
import { createInitialProfile } from '../domain/sop-ratio';

export async function seedDefaultSopProfile(): Promise<void> {
	const db = namedLocalDb(SHELTER_DB);
	const ctx = { shelterCode: SHELTER_CODE, createdBy: 'seed' };

	const { profile, audit } = createInitialProfile(
		'SOP มาตรฐาน',
		{ rice_g_per_person_meal: 150 },
		ctx
	);

	try {
		await db.put(profile);
		await db.put(audit);
		console.info('[seed] SOP profile created:', profile._id);
	} catch (e) {
		if ((e as { status?: number }).status === 409) {
			console.info('[seed] SOP profile already exists — skipped');
		} else {
			throw e;
		}
	}
}

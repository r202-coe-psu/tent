import { displayCouchUrl } from './couch';
import { deleteDailySopData, deleteDashboardData, seedDailyCalc, seedDailySop } from './daily';
import { runMasterSeed } from './master-seed';
import { provisionRegistryShelterDbs, seedRegistry } from './registry-shelters';
import { seedStagingOps } from './staging-ops';
import { seedStagingPeople } from './staging-people';
import { seedUsers } from './users';
import { seedVolunteers, seedVolunteerJobs, seedVolunteerSchedule } from './volunteers';

/**
 * Full staging/local seed:
 * master → users → shelters → provision → ~1k people → ops → volunteers → daily snapshots.
 */
export async function mainStaging(): Promise<void> {
	if (process.argv.includes('--delete-dashboard')) {
		await deleteDashboardData();
		return;
	}
	if (process.argv.includes('--delete-daily-sop')) {
		await deleteDailySopData();
		return;
	}

	console.log(`\nSeeding STAGING (master + demo volume) → ${displayCouchUrl()}\n`);

	await seedUsers();
	const master = await runMasterSeed();
	await seedRegistry(master);
	await provisionRegistryShelterDbs();
	await seedStagingPeople(master);
	await seedStagingOps();
	await seedVolunteers(master);
	// Idempotent (fixed ids, upsert) — safe after the ULID-keyed fixtures above.
	await seedVolunteerJobs(master);
	await seedVolunteerSchedule(master);
	await seedDailyCalc();
	await seedDailySop();

	console.log('\nStaging seed done.\n');
}

import { displayCouchUrl } from './couch';
import { runMasterSeed } from './master-seed';

/** Platform init only: master_data + config + catalog/SOP (no shelters/people/users). */
export async function mainMaster(): Promise<void> {
	console.log(`\nSeeding MASTER (platform init) → ${displayCouchUrl()}\n`);
	await runMasterSeed();
	console.log('\nMaster seed done.\n');
}

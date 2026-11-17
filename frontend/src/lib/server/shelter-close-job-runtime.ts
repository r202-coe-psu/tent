/**
 * Runtime wiring of the shelter close job store (CR-243): real admin CouchDB + `$env` config.
 * Routes import this; tests and the backfill script build the store from
 * `shelter-close-job.ts` directly with their own deps.
 */
import { env } from '$env/dynamic/private';
import { adminRaw } from './couch-admin';
import type { CouchReq } from './ensure-public-writer';
import { createShelterCloseJobStore, readShelterCloseConfig } from './shelter-close-job';

export const adminCouchReq: CouchReq = (method, path, body) => adminRaw(path, method, body);

export function getShelterCloseStore() {
	return createShelterCloseJobStore({
		couchReq: adminCouchReq,
		config: readShelterCloseConfig(env)
	});
}

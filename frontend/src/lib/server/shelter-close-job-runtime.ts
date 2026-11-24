/**
 * Runtime wiring of the shelter close job store (CR-243): real admin CouchDB + `$env` config.
 * Routes import this; tests and the backfill script build the store from
 * `shelter-close-job.ts` directly with their own deps.
 */
import { env } from '$env/dynamic/private';
import { adminRaw } from './couch-admin';
import type { CouchReq } from './ensure-public-writer';
import {
	createShelterCloseJobStore,
	readShelterCloseConfig,
	type ShelterCloseJobStore
} from './shelter-close-job';

export const adminCouchReq: CouchReq = (method, path, body) => adminRaw(path, method, body);

let store: ShelterCloseJobStore | null = null;

/**
 * One store per process: `ensureDesign` (create `central_ops` + the view) then runs once instead
 * of on every poll / preview / PATCH. Config is read from `$env` on first use.
 */
export function getShelterCloseStore(): ShelterCloseJobStore {
	store ??= createShelterCloseJobStore({
		couchReq: adminCouchReq,
		config: readShelterCloseConfig(env)
	});
	return store;
}

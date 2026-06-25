import { namedLocalDb } from './pouch';

export const SHELTER_CODE = 'SH001';
export const SHELTER_DB = `shelter_${SHELTER_CODE.toLowerCase()}`;

export function shelterDb(): PouchDB.Database {
	return namedLocalDb(SHELTER_DB);
}

/** Shared registry database of print devices (all shelters). */
export const PRINTING_DEVICES_DB = 'printing_devices';

const PRINTING_DB_PREFIX = 'printing_';
const SHELTER_CODE = /^[A-Z0-9]+$/;

/**
 * Database name for a shelter's own print-job CouchDB. Throws on codes that are not `[A-Z0-9]+`
 * or that would collide with {@link PRINTING_DEVICES_DB}.
 */
export function printingDbName(shelterCode: string): string {
	const code = shelterCode.toUpperCase();
	const name = `${PRINTING_DB_PREFIX}${code.toLowerCase()}`;
	if (!SHELTER_CODE.test(code) || name === PRINTING_DEVICES_DB) {
		throw new Error(`Invalid shelter code for printing database: ${JSON.stringify(shelterCode)}`);
	}
	return name;
}

/** Upper-case shelter code of a `printing_{code}` database, or null for any other name. */
export function shelterCodeFromPrintingDb(dbName: string): string | null {
	if (!dbName.startsWith(PRINTING_DB_PREFIX) || dbName === PRINTING_DEVICES_DB) return null;
	const code = dbName.slice(PRINTING_DB_PREFIX.length).toUpperCase();
	return SHELTER_CODE.test(code) ? code : null;
}

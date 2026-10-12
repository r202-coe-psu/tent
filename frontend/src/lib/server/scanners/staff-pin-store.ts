import { adminRaw } from '$lib/server/couch-admin';
import { StaffPinSecretStore } from './staff-pin-secret';

export * from './staff-pin-secret';

/** The server's staff PIN store, through the admin CouchDB client. */
export const staffPinSecretStore = new StaffPinSecretStore(adminRaw);

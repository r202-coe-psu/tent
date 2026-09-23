import { serviceFetch } from '$lib/api/service';
import type { ShelterImportLog } from '../domain/import-log';

/**
 * `shelter_import_log` history is served by the SA-only BFF. The audit database
 * contains cross-shelter data and must never be queried from the browser.
 */

export const IMPORT_LOG_AUDIT_DB = 'shelter_import_audit';

export async function listImportLogs(): Promise<ShelterImportLog[]> {
	return serviceFetch<ShelterImportLog[]>('/api/back-office/shelter-import/logs');
}

/**
 * Databases whose writes must name their writer in `updated_by` (CR-260 FR-C3/C4):
 * every shelter DB and the central catalog. Their `_design/access` rule rejects a
 * non-admin write whose `updated_by` is not the authenticated user, and the worker
 * reads it to attribute audit events. Pure so client and server writers share it.
 */
export function isAuditedWriteDb(dbName: string): boolean {
	return dbName.startsWith('shelter_') || dbName === 'catalog';
}

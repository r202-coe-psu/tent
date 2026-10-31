import { WorkflowValidationError } from './errors';

/**
 * Writes that must be authoritative (loan resolution, bulk return pools) are only allowed against
 * the central CouchDB while it is reachable; an edge or disconnected endpoint is not authoritative.
 */
export function assertCentralWriteAuthority(endpoint?: {
	active: string;
	isWritable: boolean;
}): void {
	if (!endpoint || endpoint.active !== 'central' || !endpoint.isWritable) {
		throw new WorkflowValidationError(
			'Authoritative central connectivity is required for loan resolution mutations; edge or disconnected endpoint is not authoritative'
		);
	}
}

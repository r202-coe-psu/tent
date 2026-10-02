export interface SecurityMutationLock {
	_id: string;
	_rev?: string;
	type: 'shelter_security_mutation_lock';
	owner_id: string;
	resource: string;
	lease_until: string;
}

/** Build the regular CouchDB document used to serialize `_security` updates. */
export function buildSecurityMutationLock(input: {
	id: string;
	ownerId: string;
	resource: string;
	leaseUntil: string;
	rev?: string;
}): SecurityMutationLock {
	return {
		_id: input.id,
		type: 'shelter_security_mutation_lock',
		owner_id: input.ownerId,
		resource: input.resource,
		lease_until: input.leaseUntil,
		...(input.rev ? { _rev: input.rev } : {})
	};
}

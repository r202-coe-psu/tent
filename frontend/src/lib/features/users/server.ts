/** Script-safe users exports: the barrel pulls in `.svelte` query hooks that plain `tsx` cannot load. */
export {
	STAFF_TOKEN_RANDOM_BYTES,
	formatStaffToken,
	isValidStaffTokenHash
} from './domain/staff-card';

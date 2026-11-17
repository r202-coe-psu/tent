import { ServiceError } from '$lib/server/couch-admin';
import { createUser } from '$lib/server/user-service';
import { managerAccountSpec } from '../domain/manager-account';

export type ManagerAccountResult =
	| { status: 'created'; username: string }
	| { status: 'exists'; message: string }
	| { status: 'skipped' }
	| { status: 'failed'; message: string };

/**
 * Create the centre manager login from the shelter contact. Never throws: the shelter is already
 * saved, so a taken phone or a write error is reported to the caller instead of failing the save.
 */
export async function provisionShelterManager(
	code: string,
	contact: { name?: string | null; phone?: string | null } | null | undefined
): Promise<ManagerAccountResult> {
	const spec = managerAccountSpec(code, contact);
	if (!spec) return { status: 'skipped' };
	try {
		await createUser({ ...spec, personnel_type: 'staff', must_change_password: true });
		return { status: 'created', username: spec.name };
	} catch (e) {
		if (e instanceof ServiceError && e.code === 'CONFLICT') {
			return { status: 'exists', message: e.message };
		}
		return { status: 'failed', message: e instanceof Error ? e.message : String(e) };
	}
}

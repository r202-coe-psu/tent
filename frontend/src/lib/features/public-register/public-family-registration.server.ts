/**
 * Dedicated Public CouchDB Executor (#254).
 *
 * Persists a public family registration (1 Household + N Evacuees) to the
 * shelter CouchDB in a single bulk write as `status: 'pre_registered'` and
 * `registered_via: 'web'`.
 *
 * Separate from onsite `createFamilyRegistration` (which runs under staff auth
 * and writes `arriving`). Uses the roleless `bulkAsPublicWriter` with rollback
 * compensation via `rollbackAsPublicWriter` on partial write failure.
 */
import {
	createEvacuee,
	createHousehold,
	planFamilyRegistration,
	type Evacuee,
	type Household,
	type UnifiedRegistrationInput
} from '$lib/features/people/server';
import { bulkAsPublicWriter, rollbackAsPublicWriter } from '$lib/server/couch-public-writer';
import { shelterDbName } from '$lib/server/shelter-access-design';

export interface ExecutePublicFamilyRegistrationOptions {
	shelterCode: string;
	createdBy?: string;
}

export interface PublicFamilyRegistrationResult {
	household: Household;
	evacuees: Evacuee[];
}

export class PublicRegistrationWriteError extends Error {
	constructor(
		message: string,
		public readonly failedRows: Array<{ id: string; reason: string }>,
		public readonly rolledBackRows: string[],
		public readonly orphanedRows: string[]
	) {
		super(message);
		this.name = 'PublicRegistrationWriteError';
	}
}

/**
 * Execute the public family registration CouchDB plan.
 */
export async function executePublicFamilyRegistration(
	input: UnifiedRegistrationInput,
	options: ExecutePublicFamilyRegistrationOptions
): Promise<PublicFamilyRegistrationResult> {
	const plan = planFamilyRegistration(input, 'public');
	const ctx = {
		shelterCode: options.shelterCode,
		createdBy: options.createdBy ?? 'public'
	};

	// 1. Mint household and evacuees in memory using pure domain factories
	const household = createHousehold(plan.householdInput, ctx);
	const evacuees = plan.memberInputs.map((memberInput) =>
		createEvacuee({ ...memberInput, household_id: household._id }, ctx)
	);

	if (evacuees.length === 0) {
		throw new Error('ต้องมีสมาชิกอย่างน้อย 1 คน');
	}

	household.head_evacuee_id = evacuees[0]._id;

	// 2. Perform bulk write via public writer
	const dbName = shelterDbName(options.shelterCode);
	const docsToWrite = [household, ...evacuees];
	const { status, failed, written } = await bulkAsPublicWriter(dbName, docsToWrite);

	// 3. Handle partial write failure with rollback
	if (failed.length > 0) {
		console.error(
			`public booking write failed (${status}): ` +
				failed.map((f) => `${f.id}=${f.reason}`).join(', ')
		);

		const { rolledBack, orphaned } = await rollbackAsPublicWriter(dbName, written);
		if (rolledBack.length > 0) {
			console.warn(`public booking rolled back partial write: ${rolledBack.join(', ')}`);
		}
		if (orphaned.length > 0) {
			console.error(
				`public booking LEFT ORPHAN DOCS in ${dbName} — needs manual cleanup: ${orphaned.join(', ')}`
			);
		}

		throw new PublicRegistrationWriteError('WRITE_FAILED', failed, rolledBack, orphaned);
	}

	return { household, evacuees };
}

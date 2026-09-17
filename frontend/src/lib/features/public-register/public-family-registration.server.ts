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
 *
 * Join mode: when `join_household_id` is set (resolved from match token), mint
 * only new Evacuees linked to the existing Household; append pets/vehicles/assets;
 * never overwrite Residence or head.
 */
import {
	createEvacuee,
	createHousehold,
	isActiveHouseholdStatus,
	planFamilyRegistration,
	type Evacuee,
	type Household,
	type UnifiedRegistrationInput
} from '$lib/features/people/server';
import { adminRaw } from '$lib/server/couch-admin';
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

async function loadShelterHousehold(
	shelterCode: string,
	householdId: string
): Promise<Household | null> {
	const db = shelterDbName(shelterCode);
	const res = await adminRaw(`/${db}/${encodeURIComponent(householdId)}`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new Error('ไม่สามารถอ่านครัวเรือนปลายทางได้');
	}
	const doc = res.data as Household | null;
	if (!doc || doc.type !== 'household') return null;
	return doc;
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
	const dbName = shelterDbName(options.shelterCode);

	if (plan.mode === 'join') {
		const targetId = plan.targetHouseholdId;
		if (!targetId) throw new Error('ไม่พบครัวเรือนปลายทาง');

		const existing = await loadShelterHousehold(options.shelterCode, targetId);
		if (!existing || !isActiveHouseholdStatus(existing.status)) {
			throw new PublicRegistrationWriteError(
				'JOIN_TARGET_NOT_FOUND',
				[{ id: targetId, reason: 'not_found_or_inactive' }],
				[],
				[]
			);
		}

		const evacuees = plan.memberInputs.map((memberInput) =>
			createEvacuee({ ...memberInput, household_id: targetId }, ctx)
		);
		if (evacuees.length === 0) {
			throw new Error('ต้องมีสมาชิกอย่างน้อย 1 คน');
		}

		const appendPets = (plan.householdInput.pets ?? []) as Household['pets'];
		const appendVehicles = (plan.householdInput.vehicles ?? []) as Household['vehicles'];
		const appendAssets = (plan.householdInput.assets ?? null) as Household['assets'];
		const hasAppend = appendPets.length > 0 || appendVehicles.length > 0 || appendAssets != null;

		const docsToWrite: Array<Evacuee | Household> = [...evacuees];
		let household = existing;
		if (hasAppend) {
			const mergedAssets =
				appendAssets == null
					? existing.assets
					: existing.assets
						? {
								description: [existing.assets.description, appendAssets.description]
									.filter(Boolean)
									.join('\n')
									.trim(),
								image_url: existing.assets.image_url ?? appendAssets.image_url ?? null
							}
						: appendAssets;
			household = {
				...existing,
				pets: [...(existing.pets ?? []), ...appendPets],
				vehicles: [...(existing.vehicles ?? []), ...appendVehicles],
				assets: mergedAssets
			};
			docsToWrite.push(household);
		}

		const { failed, written } = await bulkAsPublicWriter(dbName, docsToWrite);
		if (failed.length > 0) {
			const { rolledBack, orphaned } = await rollbackAsPublicWriter(dbName, written);
			throw new PublicRegistrationWriteError('WRITE_FAILED', failed, rolledBack, orphaned);
		}

		return { household, evacuees };
	}

	// 1. Mint household and evacuees in memory using pure domain factories
	const household = createHousehold(plan.householdInput, ctx);
	const evacuees = plan.memberInputs.map((memberInput) =>
		createEvacuee({ ...memberInput, household_id: household._id }, ctx)
	);

	if (evacuees.length === 0) {
		throw new Error('ต้องมีสมาชิกอย่างน้อย 1 คน');
	}

	household.head_evacuee_id = evacuees[0]!._id;

	// 2. Perform bulk write via public writer
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

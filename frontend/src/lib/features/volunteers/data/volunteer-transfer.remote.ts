import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import {
	isVolunteerTransfer,
	volunteerTransferSchema,
	makeVolunteerTransfer,
	type VolunteerTransfer,
	type VolunteerTransferInput,
	type VolunteerTransferStatus
} from '../domain/volunteer-transfer.schema';
import type { VolunteerTransferFilter, VolunteerTransferRepository } from './volunteer.repository';

/**
 * Remote CouchDB repository for the volunteers feature (`volunteer_transfer`
 * doc type).
 *
 * TODO(D-VOL-TRANSFER-APPROVE): CR-094 §7 has not decided whether this doc
 * belongs in the origin or destination shelter DB (or which side approves).
 * This adapter is bound to the *active* shelter DB (`getShelterDb()`) like
 * every other repository in this feature, and only ever reads/writes that one
 * DB — it does not reach into another shelter's DB to read the request or to
 * apply the effects of an `accepted` decision (`volunteer.current_shelter_code`
 * update + origin role revoke, FR-VOL-12.3). Once CR-094 §7 is closed this
 * class is the place to add whichever cross-DB write the decision requires —
 * do not add it speculatively.
 */
export class VolunteerTransferRemoteRepository implements VolunteerTransferRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	/**
	 * Validate before every write — `createRemoteRepository.put` validates
	 * nothing, so without this an invalid document shape persists and is then
	 * trusted on read by the rest of the slice.
	 */
	private save(doc: VolunteerTransfer): Promise<VolunteerTransfer> {
		return this.repo.put(volunteerTransferSchema.parse(doc) as VolunteerTransfer);
	}

	async list(filter?: VolunteerTransferFilter): Promise<VolunteerTransfer[]> {
		let all = await this.repo.allByType('volunteer_transfer', isVolunteerTransfer);
		if (filter?.toShelterCode) all = all.filter((t) => t.to_shelter_code === filter.toShelterCode);
		if (filter?.volunteerId) all = all.filter((t) => t.volunteer_id === filter.volunteerId);
		if (filter?.status) all = all.filter((t) => t.status === filter.status);
		return all;
	}

	async get(id: string): Promise<VolunteerTransfer | null> {
		const doc = await this.repo.get<VolunteerTransfer>(id);
		if (doc === null) return null;
		return isVolunteerTransfer(doc) ? doc : null;
	}

	async request(input: VolunteerTransferInput, ctx: AuthorContext): Promise<VolunteerTransfer> {
		return this.save(makeVolunteerTransfer(input, ctx));
	}

	// TODO(D-VOL-TRANSFER-APPROVE): see class doc — this only flips `status` +
	// `decided_by`/`decided_at` on the doc already in the active shelter DB. It
	// does not (and must not, until the decision lands) touch
	// `volunteer.current_shelter_code` or any role grant.
	async decide(
		id: string,
		decision: Extract<VolunteerTransferStatus, 'accepted' | 'rejected'>,
		actor: string
	): Promise<VolunteerTransfer> {
		const latest = await this.repo.get<VolunteerTransfer>(id);
		if (!latest) throw new Error(`ไม่พบคำขอโอนย้าย: ${id}`);
		if (latest.status !== 'pending') {
			throw new Error(`คำขอโอนย้าย ${id} ถูกพิจารณาไปแล้ว (สถานะปัจจุบัน: ${latest.status})`);
		}
		return this.save(
			touch({
				...latest,
				status: decision,
				decided_by: actor,
				decided_at: new Date().toISOString()
			})
		);
	}

	async cancel(id: string, actor: string): Promise<VolunteerTransfer> {
		const latest = await this.repo.get<VolunteerTransfer>(id);
		if (!latest) throw new Error(`ไม่พบคำขอโอนย้าย: ${id}`);
		if (latest.status !== 'pending') {
			throw new Error(`คำขอโอนย้าย ${id} ยกเลิกไม่ได้แล้ว (สถานะปัจจุบัน: ${latest.status})`);
		}
		return this.save(
			touch({
				...latest,
				status: 'cancelled' as const,
				decided_by: actor,
				decided_at: new Date().toISOString()
			})
		);
	}
}

let singleton: VolunteerTransferRepository | null = null;
let singletonDbName: string | null = null;

export function volunteerTransferRepository(): VolunteerTransferRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new VolunteerTransferRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}

/** Test-only constructor that bypasses the `getShelterDb()` singleton. */
export function createVolunteerTransferRepositoryForTest(
	dbName: string
): VolunteerTransferRemoteRepository {
	return new VolunteerTransferRemoteRepository(dbName);
}

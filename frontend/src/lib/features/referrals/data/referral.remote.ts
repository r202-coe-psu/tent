import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { touch, makeDoc, type AuthorContext } from '$lib/db/model';
import { getShelterDb } from '$lib/db/shelter';
import {
	isReferral,
	type Referral,
	type ReferralInput,
	type ReferralStatus,
	buildReferralBody,
	referralSchema
} from '../domain/referral.schema';
import { applyTransition } from '../domain/referral.transitions';
import { peopleRepository } from '$lib/features/people';
import type { ReferralRepository } from './referral.repository';

export class ReferralRemoteRepository implements ReferralRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	async list(filter?: { status?: ReferralStatus; evacuee_id?: string }): Promise<Referral[]> {
		// Note: Under the remote-first architecture, this queries CouchDB directly via the
		// browser HTTP session. An allByType scan mapped in memory is acceptable here
		// since the dataset is scoped per shelter and bounded in size.
		const all = await this.repo.allByType<Referral>('referral', isReferral);

		return all.filter((r) => {
			if (filter?.status && r.status !== filter.status) return false;
			if (filter?.evacuee_id && r.evacuee_id !== filter.evacuee_id) return false;
			return true;
		});
	}

	async get(id: string): Promise<Referral | null> {
		const doc = await this.repo.get<Referral>(id);
		return doc && isReferral(doc) ? doc : null;
	}

	async create(input: ReferralInput, ctx: AuthorContext): Promise<Referral> {
		const evacuee = await peopleRepository().getEvacuee(input.evacuee_id);
		if (!evacuee) {
			throw new Error(`Evacuee with ID ${input.evacuee_id} was not found in the active shelter.`);
		}

		const body = buildReferralBody(input);
		const rawDoc = makeDoc('referral', 1, body, ctx);

		// Validate at runtime to satisfy TS compiler constraints without explicit unsafe casting
		const doc = referralSchema.parse(rawDoc);
		return this.repo.put(doc) as Promise<Referral>;
	}

	async transition(id: string, to: ReferralStatus, actor: string): Promise<Referral> {
		const latest = await this.repo.get<Referral>(id);
		if (!latest || !isReferral(latest)) {
			throw new Error(`Referral ${id} not found or invalid`);
		}

		const updated = applyTransition(latest, to, actor, new Date().toISOString());
		// touch() fresh stamps updated_at
		return this.repo.put(touch(updated)) as Promise<Referral>;
	}
}

let singleton: ReferralRepository | null = null;
let singletonDbName: string | null = null;

export function referralRepository(): ReferralRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new ReferralRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}

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
import type { ReferralRepository } from './referral.repository';

export class ReferralRemoteRepository implements ReferralRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	async list(filter?: { status?: ReferralStatus; evacuee_id?: string }): Promise<Referral[]> {
		// Note: Since this is querying the local PouchDB client-side cache,
		// an _all_docs prefix scan (allByType) mapped in memory is acceptable
		// and doesn't pose the performance risks of a server-side CouchDB scan.
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

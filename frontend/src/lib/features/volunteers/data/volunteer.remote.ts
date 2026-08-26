import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import {
	isVolunteer,
	volunteerSchema,
	makeVolunteer,
	type Volunteer,
	type VolunteerInput,
	type VolunteerStatus
} from '../domain/volunteer.schema';
import { nextVolunteerCode } from '../domain/volunteer-code';
import type { VolunteerFilter, VolunteerRepository } from './volunteer.repository';

/**
 * Remote CouchDB repository for the volunteers feature (`volunteer` doc type).
 * Writes go to the active shelter DB (`getShelterDb()`) via cookie-authenticated
 * HTTP — mirrors `people.remote.ts` / `operations.remote.ts`.
 */
export class VolunteerRemoteRepository implements VolunteerRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	/**
	 * Validate before every write — `createRemoteRepository.put` validates
	 * nothing, so without this an invalid document shape persists and is then
	 * trusted on read by the rest of the slice.
	 */
	private save(doc: Volunteer): Promise<Volunteer> {
		return this.repo.put(volunteerSchema.parse(doc) as Volunteer);
	}

	async list(filter?: VolunteerFilter): Promise<Volunteer[]> {
		let all = await this.repo.allByType('volunteer', isVolunteer);
		if (filter?.status) all = all.filter((v) => v.status === filter.status);
		if (filter?.source) all = all.filter((v) => v.source === filter.source);
		if (filter?.checkedIn !== undefined) {
			all = all.filter((v) => v.checked_in === filter.checkedIn);
		}
		const q = filter?.search?.trim().toLowerCase();
		if (q) {
			all = all.filter((v) =>
				[v.first_name, v.last_name, v.nickname ?? '', v.phone ?? '']
					.join(' ')
					.toLowerCase()
					.includes(q)
			);
		}
		return all;
	}

	async get(id: string): Promise<Volunteer | null> {
		const doc = await this.repo.get<Volunteer>(id);
		if (doc === null) return null;
		return isVolunteer(doc) ? doc : null;
	}

	async getByTrackingToken(token: string): Promise<Volunteer | null> {
		const docs = await this.repo.find<Volunteer>({
			selector: { type: 'volunteer', tracking_token: token },
			limit: 1
		});
		return docs.filter(isVolunteer)[0] ?? null;
	}

	async getByPhoneHash(phoneHash: string): Promise<Volunteer | null> {
		const docs = await this.repo.find<Volunteer>({
			selector: { type: 'volunteer', phone_hash: phoneHash },
			limit: 1
		});
		return docs.filter(isVolunteer)[0] ?? null;
	}

	async create(
		input: VolunteerInput,
		ctx: AuthorContext,
		fields?: { status?: VolunteerStatus }
	): Promise<Volunteer> {
		const existing = await this.repo.allByType('volunteer', isVolunteer);
		const volunteer_code = nextVolunteerCode(existing.map((v) => v.volunteer_code));
		const doc = makeVolunteer(input, ctx, { volunteer_code, status: fields?.status });
		return this.save(doc);
	}

	async update(volunteer: Volunteer): Promise<Volunteer> {
		const latest = await this.repo.get<Volunteer>(volunteer._id);
		if (!latest) throw new Error(`ไม่พบข้อมูลอาสาสมัคร: ${volunteer._id}`);
		return this.save(touch({ ...volunteer, _rev: latest._rev }));
	}

	async setCheckedIn(
		id: string,
		checkedIn: boolean,
		shelterCode: string | null
	): Promise<Volunteer> {
		const latest = await this.repo.get<Volunteer>(id);
		if (!latest) throw new Error(`ไม่พบข้อมูลอาสาสมัคร: ${id}`);
		return this.save(
			touch({
				...latest,
				checked_in: checkedIn,
				current_shelter_code: checkedIn ? (shelterCode ?? latest.current_shelter_code) : null
			})
		);
	}
}

let singleton: VolunteerRepository | null = null;
let singletonDbName: string | null = null;

export function volunteerRepository(): VolunteerRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new VolunteerRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}

/** Test-only constructor that bypasses the `getShelterDb()` singleton. */
export function createVolunteerRepositoryForTest(dbName: string): VolunteerRemoteRepository {
	return new VolunteerRemoteRepository(dbName);
}

/** Test-only: force `volunteerRepository()` to rebuild against the current mocked store. */
export function clearVolunteerRepositoryCache(): void {
	singleton = null;
	singletonDbName = null;
}

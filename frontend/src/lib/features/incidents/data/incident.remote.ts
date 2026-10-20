import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { ConflictError } from '$lib/utils/errors';
import {
	INCIDENT_DOC_TYPE,
	isShelterIncident,
	nextIncidentNo,
	type IncidentCreateData,
	type ShelterIncident
} from '../domain/incident';
import { createIncident } from '../domain/incident.operations';
import type { IncidentActor } from '../domain/incident.policy';
import type { IncidentRepository } from './incident.repository';

/**
 * Remote CouchDB implementation — reads/writes the active shelter DB with the session
 * cookie. Authorization is enforced again by `_design/access` (validate_doc_update).
 */
export class IncidentRemoteRepository implements IncidentRepository {
	constructor(
		private readonly repoFor: () => Repository = () => createRemoteRepository(getShelterDb())
	) {}

	list(): Promise<ShelterIncident[]> {
		return this.repoFor().allByType(INCIDENT_DOC_TYPE, isShelterIncident);
	}

	async get(id: string): Promise<ShelterIncident | null> {
		const doc = await this.repoFor().get<ShelterIncident>(id);
		return isShelterIncident(doc) ? doc : null;
	}

	async create(data: IncidentCreateData, actor: IncidentActor): Promise<ShelterIncident> {
		const repo = this.repoFor();
		const existing = await repo.allByType(INCIDENT_DOC_TYPE, isShelterIncident);
		const incidentNo = nextIncidentNo(
			existing.map((i) => i.incident_no),
			new Date()
		);
		return repo.put(createIncident(data, actor, incidentNo));
	}

	async update(
		id: string,
		apply: (current: ShelterIncident) => ShelterIncident
	): Promise<ShelterIncident> {
		const repo = this.repoFor();
		for (let attempt = 0; ; attempt++) {
			const current = await this.get(id);
			if (!current) throw new Error('ไม่พบบันทึกเหตุการณ์นี้');
			try {
				return await repo.put(apply(current));
			} catch (err) {
				if (err instanceof ConflictError && attempt === 0) continue;
				throw err;
			}
		}
	}
}

let singleton: IncidentRepository | null = null;

export function incidentRepository(): IncidentRepository {
	if (!singleton) singleton = new IncidentRemoteRepository();
	return singleton;
}

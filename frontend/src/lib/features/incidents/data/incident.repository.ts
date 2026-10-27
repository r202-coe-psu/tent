import type { IncidentCreateData, ShelterIncident } from '../domain/incident';
import type { IncidentActor } from '../domain/incident.policy';

/** Repository contract for `shelter_incident` docs in the active shelter database. */
export interface IncidentRepository {
	list(): Promise<ShelterIncident[]>;
	get(id: string): Promise<ShelterIncident | null>;
	/** Mint `incident_no`, stamp the creator as owner, persist. */
	create(data: IncidentCreateData, actor: IncidentActor): Promise<ShelterIncident>;
	/**
	 * Read-modify-write against the latest revision: `apply` is a pure domain operation
	 * (e.g. `changeIncidentStatus`). Retries once on a 409 by re-reading and re-applying.
	 */
	update(
		id: string,
		apply: (current: ShelterIncident) => ShelterIncident
	): Promise<ShelterIncident>;
}

import { couchFetch } from '$lib/db/couch';

export interface HealthStatus {
	status: string;
}

/** CouchDB liveness probe — `GET /_up`. */
export const healthStatus = () => couchFetch<HealthStatus>('/_up');

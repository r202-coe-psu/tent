import { SHELTER_DASHBOARD_VIEWS } from './views';

/**
 * Every Map/Reduce View of a `shelter_*` database lives in ONE design document.
 *
 * Keeping a single design document is a deliberate choice, not an accident: the
 * benefits of splitting per module (independent rebuild, independent `_rev`,
 * independent rollback) only materialise once several modules own views that
 * change on different schedules. Today there is one view set, so splitting would
 * buy nothing while forcing every consumer's query path to change — and a
 * consumer that gets a `404` from a path that moved is one silent `catch` away
 * from reporting "0 evacuees" while a shelter is full.
 */
export type CouchViewDefinition = {
	map: string;
	reduce?: string;
};

export type ShelterViewManifest = {
	version: number;
	designName: string;
	views: Record<string, CouchViewDefinition>;
};

/**
 * The manifest is the FULL view set of `_design/app`, not an additive fragment.
 * Deploying it replaces `views` wholesale — it never merges with whatever is
 * already on the server. Merging would make the deployed hash permanently
 * diverge from the manifest hash, which is the only thing verification has to
 * compare against, and retired views would linger forever.
 *
 * Consequence: CI/CD is the single writer of `_design/app`. A module that needs
 * a new view adds it here through a PR; it must not PUT a design document of
 * its own on the server.
 */
export const SHELTER_VIEW_MANIFEST: ShelterViewManifest = {
	// v3 (CR-170): demographics_by_age / demographics_by_country also count room_confirmed.
	// v4 (CR-170 amend): registrations_by_date_status also emits the `preregister` series.
	// v5 (CR-192): adds the station_logs_by_station view (station_log start/complete events).
	version: 5,
	designName: 'app',
	views: SHELTER_DASHBOARD_VIEWS.views
};

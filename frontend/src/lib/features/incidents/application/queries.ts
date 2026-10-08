import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { getShelterDb } from '$lib/db/shelter';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import {
	INCIDENT_DOC_TYPE,
	type IncidentCreateData,
	type IncidentStatus,
	type ShelterIncident
} from '../domain/incident';
import {
	addIncidentNote,
	changeIncidentStatus,
	identifyRespondent,
	reassignIncident
} from '../domain/incident.operations';
import type { IncidentActor } from '../domain/incident.policy';
import { incidentRepository } from '../data/incident.remote';
import { listShelterStaff } from '../data/staff-directory.api';

export const incidentKeys = {
	all: ['incidents'] as const,
	list: (shelterCode: string) => [...incidentKeys.all, shelterCode, 'list'] as const,
	detail: (shelterCode: string, id: string) =>
		[...incidentKeys.all, shelterCode, 'detail', id] as const,
	staff: (shelterCode: string) => [...incidentKeys.all, shelterCode, 'staff'] as const
};

export const useIncidents = (shelterCode: () => string) =>
	createQuery(() => ({
		queryKey: incidentKeys.list(shelterCode()),
		queryFn: () => incidentRepository().list()
	}));

export const useIncident = (shelterCode: () => string, id: () => string) =>
	createQuery(() => ({
		queryKey: incidentKeys.detail(shelterCode(), id()),
		queryFn: () => incidentRepository().get(id()),
		enabled: !!id()
	}));

export const useShelterStaff = (shelterCode: () => string) =>
	createQuery(() => ({
		queryKey: incidentKeys.staff(shelterCode()),
		queryFn: () => listShelterStaff(shelterCode()),
		staleTime: 5 * 60_000
	}));

export const useCreateIncident = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ data, actor }: { data: IncidentCreateData; actor: IncidentActor }) =>
			incidentRepository().create(data, actor),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: incidentKeys.all })
	}));
};

/** One discriminated input for every timeline-producing action on an existing record. */
export type IncidentAction =
	| { kind: 'status'; to: IncidentStatus; note: string }
	| { kind: 'reassign'; to: string; note: string }
	| { kind: 'note'; note: string }
	| {
			kind: 'identify';
			respondent: {
				status: 'known_evacuee' | 'known_external';
				evacuee_id?: string | null;
				name_or_detail?: string | null;
			};
			note: string;
	  };

/** Apply an {@link IncidentAction} as a pure domain operation. */
export function applyIncidentAction(
	current: ShelterIncident,
	action: IncidentAction,
	actor: IncidentActor
): ShelterIncident {
	switch (action.kind) {
		case 'status':
			return changeIncidentStatus(current, action.to, action.note, actor);
		case 'reassign':
			return reassignIncident(current, action.to, action.note, actor);
		case 'note':
			return addIncidentNote(current, action.note, actor);
		case 'identify':
			return identifyRespondent(current, action.respondent, action.note, actor);
	}
}

export const useIncidentAction = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			id,
			action,
			actor
		}: {
			id: string;
			action: IncidentAction;
			actor: IncidentActor;
		}) => incidentRepository().update(id, (current) => applyIncidentAction(current, action, actor)),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: incidentKeys.all })
	}));
};

/** Push invalidation from the shelter DB changes feed — never poll. */
export function startIncidentLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) =>
		type === INCIDENT_DOC_TYPE ? [incidentKeys.all] : []
	);
}

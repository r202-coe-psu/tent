import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import {
	applyToJob,
	cancelTicket,
	fetchJobs,
	fetchProfile,
	fetchVolunteerSkills,
	fetchSchedule,
	findTickets,
	getTicket,
	respondToDispatch,
	updateProfileSkills
} from '../data/volunteer-api';
import type { PortalCredential, PublicJobFilter, VolunteerApplyInput } from '../domain/volunteer';

export const volunteerPortalKeys = {
	all: ['volunteer-portal'] as const,
	ticket: (token: string) => [...volunteerPortalKeys.all, 'ticket', token] as const,
	/** Keyed by the whole credential: signing in by phone and by token are two sessions
	 * of the same person, and must not share a cache entry that outlives a sign-out. */
	schedule: (credential: PortalCredential) =>
		[...volunteerPortalKeys.all, 'schedule', credential] as const,
	tickets: (credential: PortalCredential) =>
		[...volunteerPortalKeys.all, 'tickets', credential] as const,
	profile: (credential: PortalCredential) =>
		[...volunteerPortalKeys.all, 'profile', credential] as const,
	skills: (shelterCode?: string) =>
		[...volunteerPortalKeys.all, 'skills', shelterCode ?? 'all'] as const,
	jobs: () => [...volunteerPortalKeys.all, 'jobs'] as const,
	jobsList: (filter: PublicJobFilter) => [...volunteerPortalKeys.jobs(), 'list', filter] as const
};

export function useVolunteerTicket(token: () => string) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.ticket(token()),
		queryFn: () => getTicket(token()),
		enabled: Boolean(token()),
		retry: false
	}));
}

export function useFindTicketsMutation() {
	return createMutation(() => ({
		mutationFn: (phone: string) => findTickets({ phone })
	}));
}

export function useCancelTicketMutation() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (token: string) => cancelTicket(token),
		onSuccess: (_data, token: string) => {
			void queryClient.invalidateQueries({ queryKey: volunteerPortalKeys.ticket(token) });
		}
	}));
}

/**
 * ตารางทำงานจิตอาสา for the signed-in volunteer, however they signed in.
 *
 * A query rather than a mutation even though the lookup posts: the portal keeps showing
 * the schedule after sign-in, and check-in state moves while a shift is running, so it
 * has to be refetchable by key. `null` = signed out.
 */
export function useVolunteerSchedule(credential: () => PortalCredential | null) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.schedule(credential() ?? { phone: '' }),
		queryFn: () => fetchSchedule(credential()!),
		enabled: credential() !== null,
		staleTime: 0
	}));
}

/**
 * The signed-in volunteer's tickets, as a query rather than the one-shot mutation the
 * standalone finder uses.
 *
 * The portal keeps them on screen for as long as the session lasts and has to be able
 * to refetch — a status can move from รอการพิจารณา to ยืนยันแล้ว while the tab is open.
 */
export function useVolunteerTickets(credential: () => PortalCredential | null) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.tickets(credential() ?? { phone: '' }),
		queryFn: () => findTickets(credential()!),
		enabled: credential() !== null,
		staleTime: 0
	}));
}

/**
 * Answer an offered shift. Invalidates the schedule so the card disappears and the
 * status badge moves without the volunteer having to reload.
 */
export function useRespondToDispatchMutation(credential: () => PortalCredential | null) {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (vars: { assignment_id: string; code: string; action: 'accepted' | 'declined' }) =>
			respondToDispatch({ ...vars, ...credential()! }),
		onSuccess: () => {
			const key = credential();
			if (key) void queryClient.invalidateQueries({ queryKey: volunteerPortalKeys.schedule(key) });
		}
	}));
}

/**
 * กระดานงานอาสาสาธารณะ (CR-092 หน้าจอ 1).
 *
 * `filter` is a getter so a shelter pick re-keys and refetches server-side; the board's
 * free-text search and quota chips stay client-side, because FastAPI indexes neither.
 * Quota moves with every application elsewhere in the country, so nothing here is
 * cached beyond the render — `staleTime: 0` matches the BFF's `no-store`.
 *
 * `enabled` is for callers that only want the count once someone is signed in, so a
 * visitor sitting on the login screen does not pull the whole board.
 */
export function useVolunteerJobs(
	filter: () => PublicJobFilter = () => ({}),
	enabled: () => boolean = () => true
) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.jobsList(filter()),
		queryFn: () => fetchJobs(filter()),
		enabled: enabled(),
		staleTime: 0
	}));
}

/**
 * Send one application (FR-VOL-02).
 *
 * Invalidates the whole portal namespace: the seat it just took is gone from the board
 * for everyone, and if the applicant is signed in, their ticket list and schedule both
 * gained an entry.
 */
export function useApplyToJobMutation() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (vars: { jobId: string; input: VolunteerApplyInput }) =>
			applyToJob(vars.jobId, vars.input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: volunteerPortalKeys.all });
		}
	}));
}

/** The signed-in volunteer's own profile. `null` credential = signed out. */
export function useVolunteerProfile(credential: () => PortalCredential | null) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.profile(credential() ?? { phone: '' }),
		queryFn: () => fetchProfile(credential()!),
		enabled: credential() !== null,
		staleTime: 0
	}));
}

/**
 * Save the parts of the profile the volunteer owns.
 *
 * The response carries the merged profile back, so the cache is seeded from what the
 * server actually stored rather than from what was typed — the two differ whenever the
 * API normalises (blank and duplicate skills are dropped).
 */
export function useUpdateProfileMutation(credential: () => PortalCredential | null) {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (skills: string[]) => updateProfileSkills({ skills, ...credential()! }),
		onSuccess: (profile) => {
			const key = credential();
			if (!key) return;
			if (profile) queryClient.setQueryData(volunteerPortalKeys.profile(key), profile);
			void queryClient.invalidateQueries({ queryKey: volunteerPortalKeys.profile(key) });
		}
	}));
}

/**
 * The Master Data skill list the profile form offers.
 *
 * Cached for the session: it is small, shared by every form that offers skills, and
 * changes only when someone edits master data — unlike quota, nobody is harmed by a
 * list that is a few minutes old (the endpoint itself allows 5 minutes of caching).
 */
export function useVolunteerSkills(shelterCode: () => string | undefined = () => undefined) {
	return createQuery(() => ({
		queryKey: volunteerPortalKeys.skills(shelterCode()),
		queryFn: () => fetchVolunteerSkills(shelterCode()),
		staleTime: 5 * 60 * 1000
	}));
}

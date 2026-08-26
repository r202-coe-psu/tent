/**
 * Application layer for the volunteers feature (00-foundation.md §00.4).
 *
 * TanStack Query hooks glueing the domain (pure logic) to the data layer
 * (repository interfaces / `*.remote.ts` factories). Style mirrors
 * `referrals/application/queries.ts`: a `getShelterCode()`-scoped key
 * factory, `createQuery(() => ({...}))` / `createMutation(() => ({...}))`
 * callback form, mutations take `queryClient: QueryClient` as a parameter
 * (the caller supplies it via `useQueryClient()`), and author context is
 * built the same way (`shelterCode: getShelterCode()`, `createdBy:
 * authStore.user?.name ?? 'unknown'`).
 *
 * `useHubMetrics` is the ONLY hook allowed to produce the 5 Control Hub
 * counters — it calls `domain/hub-metrics.ts#computeHubMetrics` and nothing
 * else here recomputes them (CR-094 FR-VOL-08.2 / AC-094-09).
 */

import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import { getShelterCode, getShelterDb } from '$lib/db/shelter';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { authStore } from '$lib/stores/auth.svelte';
import { bangkokDateString } from '../domain/duty-window';
import { computeHubMetrics } from '../domain/hub-metrics';
import type { Job, JobInput } from '../domain/job.schema';
import type { JobApplicationStatus } from '../domain/job-application.schema';
import type { CheckInMethod, ShiftAssignmentInput } from '../domain/shift-assignment.schema';
import type { VolunteerInput } from '../domain/volunteer.schema';
import type {
	VolunteerTransferInput,
	VolunteerTransferStatus
} from '../domain/volunteer-transfer.schema';
import { jobRepository } from '../data/job.remote';
import { jobApplicationRepository } from '../data/job-application.remote';
import { shiftAssignmentRepository } from '../data/shift-assignment.remote';
import { volunteerRepository } from '../data/volunteer.remote';
import { volunteerTransferRepository } from '../data/volunteer-transfer.remote';
import type {
	JobApplicationFilter,
	JobFilter,
	ShiftAssignmentFilter,
	VolunteerFilter,
	VolunteerTransferFilter
} from '../data/volunteer.repository';

/** Calendar date "today" is evaluated against, in **Asia/Bangkok** — the same
 * wall-clock convention `domain/duty-window.ts` uses to build `duty_window`.
 * Deriving it from UTC instead would query yesterday's roster between 00:00
 * and 07:00 local, i.e. for the whole of the `night` shift. */
function todayDateString(): string {
	return bangkokDateString();
}

// ---------------------------------------------------------------------------
// Query-key factory — every list/detail key is scoped by `getShelterCode()`
// so switching the active shelter invalidates + refetches against the newly
// selected shelter's database (mirrors `people/application/queries.ts`).
// ---------------------------------------------------------------------------

export const volunteerKeys = {
	all: ['volunteers'] as const,

	hubMetrics: () => [...volunteerKeys.all, 'hubMetrics', getShelterCode()] as const,

	jobsAll: () => [...volunteerKeys.all, 'jobs', getShelterCode()] as const,
	jobsList: (filter?: JobFilter) => [...volunteerKeys.jobsAll(), 'list', filter] as const,
	jobsDetails: () => [...volunteerKeys.jobsAll(), 'detail'] as const,
	jobDetail: (id: string) => [...volunteerKeys.jobsDetails(), id] as const,

	jobApplicationsAll: () => [...volunteerKeys.all, 'jobApplications', getShelterCode()] as const,
	jobApplicationsList: (filter?: JobApplicationFilter) =>
		[...volunteerKeys.jobApplicationsAll(), 'list', filter] as const,

	shiftAssignmentsAll: () => [...volunteerKeys.all, 'shiftAssignments', getShelterCode()] as const,
	shiftAssignmentsList: (filter?: ShiftAssignmentFilter) =>
		[...volunteerKeys.shiftAssignmentsAll(), 'list', filter] as const,
	/** Nested under `shiftAssignmentsAll()` so invalidating that key also busts today's attendance. */
	todayAttendance: (date: string) =>
		[...volunteerKeys.shiftAssignmentsAll(), 'today', date] as const,

	volunteersAll: () => [...volunteerKeys.all, 'volunteers', getShelterCode()] as const,
	volunteersList: (filter?: VolunteerFilter) =>
		[...volunteerKeys.volunteersAll(), 'list', filter] as const,
	volunteersDetails: () => [...volunteerKeys.volunteersAll(), 'detail'] as const,
	volunteerDetail: (id: string) => [...volunteerKeys.volunteersDetails(), id] as const,

	transfersAll: () => [...volunteerKeys.all, 'transfers', getShelterCode()] as const,
	transfersList: (filter?: VolunteerTransferFilter) =>
		[...volunteerKeys.transfersAll(), 'list', filter] as const
};

/** Build the `{shelterCode, createdBy}` author context the same way every mutation does. */
function authorContext() {
	return { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'unknown' };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The 5 Control Hub counters (CR-094 FR-VOL-08.2). Fetches today's
 * shift_assignments (so `assigned`/`checkedInNow` mean "today", not "ever"),
 * all volunteers, and all job_applications, then hands them to the single
 * domain function that computes the counters — this hook must never
 * recompute them inline (AC-094-09).
 */
export const useHubMetrics = () =>
	createQuery(() => ({
		queryKey: volunteerKeys.hubMetrics(),
		queryFn: async () => {
			const today = todayDateString();
			const [volunteers, assignments, applications] = await Promise.all([
				volunteerRepository().list(),
				shiftAssignmentRepository().list({ date: today }),
				jobApplicationRepository().list()
			]);
			return computeHubMetrics({ volunteers, assignments, applications, today });
		}
	}));

export const useJobs = (filter?: JobFilter) =>
	createQuery(() => ({
		queryKey: volunteerKeys.jobsList(filter),
		queryFn: () => jobRepository().list(filter)
	}));

export const useJob = (id: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: volunteerKeys.jobDetail(id()),
		queryFn: () => jobRepository().get(id()),
		enabled: enabled() && !!id()
	}));

export const useJobApplications = (filter?: JobApplicationFilter) =>
	createQuery(() => ({
		queryKey: volunteerKeys.jobApplicationsList(filter),
		queryFn: () => jobApplicationRepository().list(filter)
	}));

export const useShiftAssignments = (filter?: ShiftAssignmentFilter) =>
	createQuery(() => ({
		queryKey: volunteerKeys.shiftAssignmentsList(filter),
		queryFn: () => shiftAssignmentRepository().list(filter)
	}));

/** Today's roster & attendance tab — always "today" in Asia/Bangkok. */
export const useTodayAttendance = () =>
	createQuery(() => ({
		queryKey: volunteerKeys.todayAttendance(todayDateString()),
		queryFn: () => shiftAssignmentRepository().list({ date: todayDateString() })
	}));

export const useVolunteers = (filter?: VolunteerFilter) =>
	createQuery(() => ({
		queryKey: volunteerKeys.volunteersList(filter),
		queryFn: () => volunteerRepository().list(filter)
	}));

export const useVolunteer = (id: () => string, enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: volunteerKeys.volunteerDetail(id()),
		queryFn: () => volunteerRepository().get(id()),
		enabled: enabled() && !!id()
	}));

export const useTransfers = (filter?: VolunteerTransferFilter) =>
	createQuery(() => ({
		queryKey: volunteerKeys.transfersList(filter),
		queryFn: () => volunteerTransferRepository().list(filter)
	}));

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** New jobs always start `draft` with the full quota unclaimed — no quota move, so hub metrics are unaffected. */
export const useCreateJob = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: JobInput) => jobRepository().create(input, authorContext()),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.jobsAll() });
		}
	}));

/** Metadata-only edit (title/description/status/etc) — never touches `slots_*`, so hub metrics are unaffected. */
export const useUpdateJob = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (job: Job) => jobRepository().update(job),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.jobsAll() });
		}
	}));

/**
 * SM dispatches a volunteer to a job: creates a `shift_assignment` AND moves
 * `job.slots_remaining -> slots_dispatched` (`ShiftAssignmentRepository#dispatch`).
 * Quota-changing — invalidate jobs (slots moved), shift assignments (new doc,
 * covers today's attendance too), and the hub metrics `assigned` counter.
 */
export const useDispatchVolunteers = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: ShiftAssignmentInput) =>
			shiftAssignmentRepository().dispatch(input, authorContext()),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.jobsAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.shiftAssignmentsAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.hubMetrics() });
		}
	}));

/**
 * SM reviews a `pending_review` application. `confirmed` consumes one job
 * slot (`job.slots_remaining -> slots_confirmed`); either decision moves the
 * application out of `pending_review`, changing the hub metrics
 * `pendingApproval` counter. Quota-changing — invalidate applications, jobs,
 * and hub metrics.
 */
export const useReviewApplication = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: ({
			id,
			decision,
			notes
		}: {
			id: string;
			decision: Extract<JobApplicationStatus, 'confirmed' | 'rejected'>;
			notes?: string | null;
		}) => jobApplicationRepository().review(id, decision, authStore.user?.name ?? 'unknown', notes),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.jobApplicationsAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.jobsAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.hubMetrics() });
		}
	}));

/**
 * Records check-in: `shift_assignment.status -> checked_in` +
 * `volunteer.checked_in -> true`. No `job.slots_*` move, but both the
 * assignment status and the volunteer's `checked_in` flag feed the hub
 * metrics `ready`/`assigned`/`checkedInNow` counters — invalidate shift
 * assignments, volunteers, and hub metrics.
 */
export const useCheckIn = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: ({
			id,
			method,
			reason
		}: {
			id: string;
			method?: CheckInMethod;
			reason?: string | null;
		}) =>
			shiftAssignmentRepository().checkIn(id, authStore.user?.name ?? 'unknown', method, reason),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.shiftAssignmentsAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.volunteersAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.hubMetrics() });
		}
	}));

/** Records check-out: `shift_assignment.status -> completed` + `volunteer.checked_in -> false`. Same fan-out as check-in. */
export const useCheckOut = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (id: string) => shiftAssignmentRepository().checkOut(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.shiftAssignmentsAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.volunteersAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.hubMetrics() });
		}
	}));

/**
 * Mints a volunteer profile from the SM-facing walk-in form
 * (`input.source` carries `'walk_in'`). A newly active volunteer changes the
 * hub metrics `ready`/`pendingIdentity` counters — invalidate volunteers and
 * hub metrics.
 */
export const useCreateWalkInVolunteer = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: VolunteerInput) => volunteerRepository().create(input, authorContext()),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.volunteersAll() });
			queryClient.invalidateQueries({ queryKey: volunteerKeys.hubMetrics() });
		}
	}));

/**
 * Requests a `volunteer_transfer` (`status: 'pending'`). Transfers are not
 * part of `computeHubMetrics`'s input, so this only invalidates transfers.
 */
export const useRequestTransfer = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: (input: VolunteerTransferInput) =>
			volunteerTransferRepository().request(input, authorContext()),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.transfersAll() });
		}
	}));

/**
 * Accepts/rejects a pending transfer request. Per
 * `data/volunteer.repository.ts#VolunteerTransferRepository.decide`
 * (TODO(D-VOL-TRANSFER-APPROVE), CR-094 §7 open), this does not touch
 * `volunteer.current_shelter_code` or `checked_in` — hub metrics are
 * unaffected, only transfers need invalidating.
 */
export const useDecideTransfer = (queryClient: QueryClient) =>
	createMutation(() => ({
		mutationFn: ({
			id,
			decision
		}: {
			id: string;
			decision: Extract<VolunteerTransferStatus, 'accepted' | 'rejected'>;
		}) => volunteerTransferRepository().decide(id, decision, authStore.user?.name ?? 'unknown'),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: volunteerKeys.transfersAll() });
		}
	}));

// ---------------------------------------------------------------------------
// Live updates — one shared wiring for the whole feature (mirrors
// `referrals/application/queries.ts#startReferralsLiveQuery`).
// ---------------------------------------------------------------------------

export function startVolunteersLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		if (type === 'job') {
			return [volunteerKeys.jobsAll(), volunteerKeys.hubMetrics()];
		}
		if (type === 'job_application') {
			return [volunteerKeys.jobApplicationsAll(), volunteerKeys.hubMetrics()];
		}
		if (type === 'shift_assignment') {
			return [volunteerKeys.shiftAssignmentsAll(), volunteerKeys.hubMetrics()];
		}
		if (type === 'volunteer') {
			return [volunteerKeys.volunteersAll(), volunteerKeys.hubMetrics()];
		}
		if (type === 'volunteer_transfer') {
			return [volunteerKeys.transfersAll()];
		}
		return [];
	});
}

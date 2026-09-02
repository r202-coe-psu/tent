// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { user: { name: 'sm_user' } }
}));

const jobRepo = {
	list: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	dispatch: vi.fn(),
	acceptDispatch: vi.fn(),
	declineDispatch: vi.fn(),
	confirmSlot: vi.fn()
};
vi.mock('../data/job.remote', () => ({
	jobRepository: () => jobRepo
}));

const jobApplicationRepo = {
	list: vi.fn(),
	get: vi.fn(),
	getByTrackingToken: vi.fn(),
	create: vi.fn(),
	review: vi.fn(),
	cancel: vi.fn()
};
vi.mock('../data/job-application.remote', () => ({
	jobApplicationRepository: () => jobApplicationRepo
}));

const shiftAssignmentRepo = {
	list: vi.fn(),
	get: vi.fn(),
	dispatch: vi.fn(),
	acceptDispatch: vi.fn(),
	declineDispatch: vi.fn(),
	checkIn: vi.fn(),
	checkOut: vi.fn()
};
vi.mock('../data/shift-assignment.remote', () => ({
	shiftAssignmentRepository: () => shiftAssignmentRepo
}));

const volunteerRepo = {
	list: vi.fn(),
	get: vi.fn(),
	getByTrackingToken: vi.fn(),
	getByPhoneHash: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	setCheckedIn: vi.fn()
};
/** Shelter code the last `volunteerRepositoryFor()` call asked for — `undefined` = active shelter. */
let requestedVolunteerShelter: string | undefined;
vi.mock('../data/volunteer.remote', () => ({
	volunteerRepository: () => volunteerRepo,
	volunteerRepositoryFor: (shelterCode?: string) => {
		requestedVolunteerShelter = shelterCode;
		return volunteerRepo;
	}
}));

const volunteerTransferRepo = {
	list: vi.fn(),
	get: vi.fn(),
	request: vi.fn(),
	decide: vi.fn(),
	cancel: vi.fn()
};
vi.mock('../data/volunteer-transfer.remote', () => ({
	volunteerTransferRepository: () => volunteerTransferRepo
}));

const computeHubMetrics = vi.fn<(input: unknown) => Record<string, number>>(() => ({
	ready: 0,
	assigned: 0,
	checkedInNow: 0,
	completed: 0,
	pendingApproval: 0,
	pendingIdentity: 0
}));
vi.mock('../domain/hub-metrics', () => ({
	computeHubMetrics: (input: unknown) => computeHubMetrics(input)
}));

const subscribeCalls: Array<{ keysForType: (t: string) => unknown }> = [];
vi.mock('$lib/db/subscribe-data-changes', () => ({
	subscribeDataChanges: (_qc: unknown, _db: unknown, keysForType: (t: string) => unknown) => {
		subscribeCalls.push({ keysForType });
		return { stop: vi.fn() };
	}
}));

// createMutation returns a real `.mutate` that runs mutationFn then onSuccess —
// mirrors `resource-calc/application/queries.test.ts` / `sop-ratios/application/queries.test.ts`
// so call sites never need to cast the statically-typed `CreateMutationResult`.
vi.mock('@tanstack/svelte-query', () => ({
	createQuery: (fn: () => unknown) => fn(),
	createMutation: (fn: () => Record<string, unknown>) => {
		const options = fn();
		return {
			mutate: async (variables: unknown) => {
				const mutationFn = options.mutationFn as (v: unknown) => Promise<unknown>;
				const onSuccess = options.onSuccess as ((d: unknown, v: unknown) => void) | undefined;
				const data = await mutationFn(variables);
				onSuccess?.(data, variables);
				return data;
			}
		};
	}
}));

import type { QueryClient } from '@tanstack/svelte-query';
import {
	volunteerKeys,
	useHubMetrics,
	useJobs,
	useJob,
	useJobApplications,
	useShiftAssignments,
	useTodayAttendance,
	useVolunteers,
	useVolunteer,
	useTransfers,
	useCreateJob,
	useUpdateJob,
	useDispatchVolunteers,
	useReviewApplication,
	useCheckIn,
	useCheckOut,
	useCreateWalkInVolunteer,
	useSetVolunteerAccountLink,
	useRequestTransfer,
	useDecideTransfer,
	startVolunteersLiveQuery
} from './queries';

function fakeQueryClient(): QueryClient {
	return { invalidateQueries: vi.fn() } as unknown as QueryClient;
}

beforeEach(() => {
	vi.clearAllMocks();
	subscribeCalls.length = 0;
	jobRepo.list.mockResolvedValue([]);
	jobApplicationRepo.list.mockResolvedValue([]);
	shiftAssignmentRepo.list.mockResolvedValue([]);
	volunteerRepo.list.mockResolvedValue([]);
	volunteerTransferRepo.list.mockResolvedValue([]);
});

describe('volunteerKeys', () => {
	it('scopes every list/detail key by getShelterCode()', () => {
		expect(volunteerKeys.hubMetrics()).toEqual(['volunteers', 'hubMetrics', 'SH001']);
		expect(volunteerKeys.jobsList({ status: 'open' })).toEqual([
			'volunteers',
			'jobs',
			'SH001',
			'list',
			{ status: 'open' }
		]);
		expect(volunteerKeys.jobDetail('job:1')).toEqual([
			'volunteers',
			'jobs',
			'SH001',
			'detail',
			'job:1'
		]);
		expect(volunteerKeys.volunteerDetail('volunteer:1')).toEqual([
			'volunteers',
			'volunteers',
			'SH001',
			'detail',
			'volunteer:1'
		]);
	});

	it('nests todayAttendance under shiftAssignmentsAll so invalidating the parent busts it too', () => {
		const today = volunteerKeys.todayAttendance('2026-08-26');
		const parent = volunteerKeys.shiftAssignmentsAll();
		expect(today.slice(0, parent.length)).toEqual(parent);
	});
});

describe('useHubMetrics', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('fetches volunteers, today shift_assignments, and applications, then delegates to computeHubMetrics with an explicit today (F6 — never new Date() inside the domain function)', async () => {
		const volunteers = [{ status: 'active', identity_verified: true }];
		const applications = [{ status: 'pending_review' }];
		const assignments = [{ volunteer_id: 'volunteer:1', date: '2026-08-26', status: 'checked_in' }];
		volunteerRepo.list.mockResolvedValue(volunteers);
		jobApplicationRepo.list.mockResolvedValue(applications);
		shiftAssignmentRepo.list.mockResolvedValue(assignments);
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-26T05:00:00.000Z')); // 12:00 Bangkok — same date either way

		const result = useHubMetrics() as unknown as { queryFn: () => Promise<unknown> };
		await result.queryFn();

		expect(shiftAssignmentRepo.list).toHaveBeenCalledWith({ date: '2026-08-26' });
		expect(computeHubMetrics).toHaveBeenCalledWith({
			volunteers,
			assignments,
			applications,
			today: '2026-08-26'
		});
	});

	it('resolves "today" in Asia/Bangkok, not UTC (D1)', async () => {
		volunteerRepo.list.mockResolvedValue([]);
		jobApplicationRepo.list.mockResolvedValue([]);
		shiftAssignmentRepo.list.mockResolvedValue([]);
		vi.useFakeTimers();
		// 02:00 Bangkok on the 27th — the UTC date is still the 26th. A
		// UTC-derived "today" queries yesterday's roster for the whole of the
		// night shift (00:00–08:00 local).
		vi.setSystemTime(new Date('2026-08-26T19:00:00.000Z'));

		const result = useHubMetrics() as unknown as { queryFn: () => Promise<unknown> };
		await result.queryFn();

		expect(shiftAssignmentRepo.list).toHaveBeenCalledWith({ date: '2026-08-27' });
		expect(computeHubMetrics).toHaveBeenCalledWith(
			expect.objectContaining({ today: '2026-08-27' })
		);
	});
});

describe('list/detail query hooks', () => {
	it('useJobs wires the filter into both the key and the repository call', () => {
		const filter = { status: 'open' as const };
		const result = useJobs(filter);
		expect(result).toMatchObject({ queryKey: volunteerKeys.jobsList(filter) });
		(result as unknown as { queryFn: () => unknown }).queryFn();
		expect(jobRepo.list).toHaveBeenCalledWith(filter);
	});

	it('useJob is keyed/enabled off the id accessor', () => {
		const result = useJob(() => 'job:1');
		expect(result).toMatchObject({ queryKey: volunteerKeys.jobDetail('job:1'), enabled: true });
		(result as unknown as { queryFn: () => unknown }).queryFn();
		expect(jobRepo.get).toHaveBeenCalledWith('job:1');
	});

	it('useJob disables when id is empty', () => {
		expect(useJob(() => '')).toMatchObject({ enabled: false });
	});

	it('useJobApplications filters through to the repository', () => {
		const filter = { jobId: 'job:1' };
		(useJobApplications(filter) as unknown as { queryFn: () => unknown }).queryFn();
		expect(jobApplicationRepo.list).toHaveBeenCalledWith(filter);
	});

	it('useShiftAssignments filters through to the repository', () => {
		const filter = { volunteerId: 'volunteer:1' };
		(useShiftAssignments(filter) as unknown as { queryFn: () => unknown }).queryFn();
		expect(shiftAssignmentRepo.list).toHaveBeenCalledWith(filter);
	});

	it("useTodayAttendance defaults to today's date", () => {
		(useTodayAttendance() as unknown as { queryFn: () => unknown }).queryFn();
		expect(shiftAssignmentRepo.list).toHaveBeenCalledWith({
			date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
		});
	});

	it('useTodayAttendance queries (and keys by) the date the caller picks', () => {
		const hook = useTodayAttendance(() => '2026-08-01');
		expect((hook as unknown as { queryKey: readonly unknown[] }).queryKey).toContain('2026-08-01');
		(hook as unknown as { queryFn: () => unknown }).queryFn();
		expect(shiftAssignmentRepo.list).toHaveBeenCalledWith({ date: '2026-08-01' });
	});

	it('useVolunteers filters through to the repository', () => {
		const filter = { status: 'active' as const };
		(useVolunteers(filter) as unknown as { queryFn: () => unknown }).queryFn();
		expect(volunteerRepo.list).toHaveBeenCalledWith(filter);
	});

	it('useVolunteers reads the shelter the caller names, not the active one', () => {
		const hook = useVolunteers({ status: 'active' as const }, () => 'SH009');
		expect((hook as unknown as { queryKey: readonly unknown[] }).queryKey).toContain('SH009');
		(hook as unknown as { queryFn: () => unknown }).queryFn();
		expect(requestedVolunteerShelter).toBe('SH009');
	});

	it('useVolunteer is keyed/enabled off the id accessor', () => {
		const result = useVolunteer(() => 'volunteer:1');
		expect(result).toMatchObject({ enabled: true });
		(result as unknown as { queryFn: () => unknown }).queryFn();
		expect(volunteerRepo.get).toHaveBeenCalledWith('volunteer:1');
	});

	it('useTransfers filters through to the repository', () => {
		const filter = { status: 'pending' as const };
		(useTransfers(filter) as unknown as { queryFn: () => unknown }).queryFn();
		expect(volunteerTransferRepo.list).toHaveBeenCalledWith(filter);
	});
});

describe('mutation author context', () => {
	it('useCreateJob passes shelterCode/createdBy from getShelterCode()/authStore', async () => {
		jobRepo.create.mockResolvedValue({});
		await useCreateJob(fakeQueryClient()).mutate({ title: 'x' } as never);
		expect(jobRepo.create).toHaveBeenCalledWith(
			{ title: 'x' },
			{ shelterCode: 'SH001', createdBy: 'sm_user' }
		);
	});

	it('useCreateWalkInVolunteer passes shelterCode/createdBy from getShelterCode()/authStore', async () => {
		volunteerRepo.create.mockResolvedValue({});
		await useCreateWalkInVolunteer(fakeQueryClient()).mutate({ first_name: 'a' } as never);
		expect(volunteerRepo.create).toHaveBeenCalledWith(
			{ first_name: 'a' },
			{ shelterCode: 'SH001', createdBy: 'sm_user' }
		);
	});

	it('useRequestTransfer passes shelterCode/createdBy from getShelterCode()/authStore', async () => {
		volunteerTransferRepo.request.mockResolvedValue({});
		await useRequestTransfer(fakeQueryClient()).mutate({ volunteer_id: 'volunteer:1' } as never);
		expect(volunteerTransferRepo.request).toHaveBeenCalledWith(
			{ volunteer_id: 'volunteer:1' },
			{ shelterCode: 'SH001', createdBy: 'sm_user' }
		);
	});
});

describe('mutation invalidation map', () => {
	it('useCreateJob invalidates only jobs (no quota move yet)', async () => {
		jobRepo.create.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useCreateJob(qc).mutate({} as never);
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.jobsAll() });
	});

	it('useUpdateJob invalidates only jobs (metadata-only edit)', async () => {
		jobRepo.update.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useUpdateJob(qc).mutate({} as never);
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.jobsAll() });
	});

	it('useDispatchVolunteers invalidates jobs + shiftAssignments + hubMetrics (quota-changing)', async () => {
		shiftAssignmentRepo.dispatch.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useDispatchVolunteers(qc).mutate({} as never);
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(3);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.jobsAll() });
		expect(qc.invalidateQueries).toHaveBeenCalledWith({
			queryKey: volunteerKeys.shiftAssignmentsAll()
		});
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.hubMetrics() });
	});

	it('useReviewApplication invalidates applications + jobs + hubMetrics (quota-changing)', async () => {
		jobApplicationRepo.review.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useReviewApplication(qc).mutate({ id: 'job_application:1', decision: 'confirmed' });
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(3);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({
			queryKey: volunteerKeys.jobApplicationsAll()
		});
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.jobsAll() });
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.hubMetrics() });
	});

	it('useCheckIn invalidates shiftAssignments + volunteers + hubMetrics', async () => {
		shiftAssignmentRepo.checkIn.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useCheckIn(qc).mutate({ id: 'shift_assignment:1' });
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(3);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({
			queryKey: volunteerKeys.shiftAssignmentsAll()
		});
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.volunteersAll() });
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.hubMetrics() });
	});

	it('useCheckOut invalidates shiftAssignments + volunteers + hubMetrics', async () => {
		shiftAssignmentRepo.checkOut.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useCheckOut(qc).mutate('shift_assignment:1');
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(3);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({
			queryKey: volunteerKeys.shiftAssignmentsAll()
		});
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.volunteersAll() });
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.hubMetrics() });
	});

	it('useCreateWalkInVolunteer invalidates volunteers + hubMetrics', async () => {
		volunteerRepo.create.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useCreateWalkInVolunteer(qc).mutate({} as never);
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(2);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.volunteersAll() });
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.hubMetrics() });
	});

	it('useRequestTransfer invalidates only transfers (not part of hub metrics)', async () => {
		volunteerTransferRepo.request.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useRequestTransfer(qc).mutate({} as never);
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.transfersAll() });
	});

	it('useDecideTransfer invalidates only transfers (decide does not touch volunteer/current_shelter_code yet)', async () => {
		volunteerTransferRepo.decide.mockResolvedValue({});
		const qc = fakeQueryClient();
		await useDecideTransfer(qc).mutate({ id: 'volunteer_transfer:1', decision: 'accepted' });
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.transfersAll() });
	});
});

describe('startVolunteersLiveQuery', () => {
	it('maps each doc type to the keys it feeds, including hubMetrics wherever it is an input', () => {
		startVolunteersLiveQuery(fakeQueryClient());

		expect(subscribeCalls).toHaveLength(1);
		const { keysForType } = subscribeCalls[0]!;

		expect(keysForType('job')).toEqual([volunteerKeys.jobsAll(), volunteerKeys.hubMetrics()]);
		expect(keysForType('job_application')).toEqual([
			volunteerKeys.jobApplicationsAll(),
			volunteerKeys.hubMetrics()
		]);
		expect(keysForType('shift_assignment')).toEqual([
			volunteerKeys.shiftAssignmentsAll(),
			volunteerKeys.hubMetrics()
		]);
		expect(keysForType('volunteer')).toEqual([
			volunteerKeys.volunteersAll(),
			volunteerKeys.hubMetrics()
		]);
		expect(keysForType('volunteer_transfer')).toEqual([volunteerKeys.transfersAll()]);
		expect(keysForType('evacuee')).toEqual([]);
	});
});

describe('useSetVolunteerAccountLink', () => {
	const profile = { _id: 'volunteer:1', user_name: 'somchai' };

	it('clears the link in the shelter the caller names', async () => {
		volunteerRepo.get.mockResolvedValue({ ...profile });
		volunteerRepo.update.mockImplementation(async (v: unknown) => v);
		const client = fakeQueryClient();

		await useSetVolunteerAccountLink(client).mutate({
			volunteerId: 'volunteer:1',
			userName: null,
			shelterCode: 'SH009',
			expectUserName: 'somchai'
		});

		expect(requestedVolunteerShelter).toBe('SH009');
		expect(volunteerRepo.update).toHaveBeenCalledWith({ ...profile, user_name: null });
		expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: volunteerKeys.all });
	});

	it('leaves a profile alone once someone else has claimed it', async () => {
		volunteerRepo.get.mockResolvedValue({ ...profile, user_name: 'malee' });

		await useSetVolunteerAccountLink(fakeQueryClient()).mutate({
			volunteerId: 'volunteer:1',
			userName: null,
			expectUserName: 'somchai'
		});

		expect(volunteerRepo.update).not.toHaveBeenCalled();
	});

	it('is a no-op when the profile is already gone', async () => {
		volunteerRepo.get.mockResolvedValue(null);

		await useSetVolunteerAccountLink(fakeQueryClient()).mutate({
			volunteerId: 'volunteer:1',
			userName: 'somchai'
		});

		expect(volunteerRepo.update).not.toHaveBeenCalled();
	});
});

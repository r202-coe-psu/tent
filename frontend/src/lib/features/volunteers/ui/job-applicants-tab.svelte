<script lang="ts">
	/**
	 * Job detail — Tab 3 "ผู้สมัคร (Applicants & Queue)" (01-tab-job-board.md
	 * §01.5, approved mockup 2026-08-30): summary tiles over one card holding the
	 * applicant list. Volunteers staff assigned directly (no application) are listed in the
	 * history beside the decided applications (`buildApplicantBoard`).
	 *
	 * Approving is the moment a job slot is consumed — the whole write path
	 * (`JobApplicationRepository#review` → `JobRepository#confirmSlot`, with the
	 * application doc rolled back if the slot cannot be taken) already lives in
	 * the data layer; this screen is the queue that drives it.
	 *
	 * Everything is read from CouchDB with `_find` scoped to this job (#1520), not by loading every
	 * application and assignment of the shelter. The tiles come from slim field projections
	 * (`applicantSummary`); each list below is one DB page — status and shift go into the selector,
	 * `bookmark` pages it — and the name search and attendance filters narrow the rows on screen.
	 */
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { canAccessVolunteerBackoffice } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter } from '$lib/features/shelters';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import BookmarkPager from './bookmark-pager.svelte';
	import JobApplicantRow from './job-applicant-row.svelte';
	import JobApplicantReviewDialog from './job-applicant-review-dialog.svelte';
	import StaffAssignmentRow from './staff-assignment-row.svelte';
	import { applicationEntry, historyBreakdown, staffEntry } from '../domain/applicant-board';
	import { groupApplicationsByApplicant } from '../domain/applicant-queue';
	import { volunteerAccessStatus } from '../domain/volunteer-access-status';
	import {
		EMPTY_APPLICANT_FILTERS,
		filterApplicantBoard,
		hasActiveApplicantFilters,
		type ApplicantAttendanceFilter,
		type ApplicantStatusFilter
	} from '../domain/applicant-filter';
	import type { Job } from '../domain/job.schema';
	import type { JobApplication } from '../domain/job-application.schema';
	import {
		todayDateString,
		useApplicantSummary,
		useJobApplicationPage,
		useShelterVolunteerAccounts,
		useSkillOptions,
		useStaffAssignmentPage,
		useVolunteerPageAssignments,
		useVolunteers
	} from '../application/queries';
	import { createMinuteClock } from './minute-clock.svelte';

	let { job }: { job: Job } = $props();

	const summaryQuery = useApplicantSummary(() => job._id);
	const volunteersQuery = useVolunteers();
	const skillCatalog = useSkillOptions();

	// Each applicant's system account and role here, with the same give / edit / revoke button as
	// the people tab (#1044). SA / SM / coordinator only; the server 403s anyone else.
	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterQuery = useShelter(() => shelterCode);
	const shelterLine = $derived(shelterQuery.data?.name ?? shelterCode ?? '—');
	const canReadAccounts = $derived(
		canAccessVolunteerBackoffice(authStore.user?.roles ?? [], shelterCode)
	);
	const accountsQuery = useShelterVolunteerAccounts(
		() => shelterCode,
		() => canReadAccounts
	);
	const accounts = $derived(canReadAccounts ? accountsQuery.data : undefined);

	const loading = $derived(summaryQuery.isPending || volunteersQuery.isPending);
	// #885 — "รอยืนยันการเข้างาน" turns on as time passes, so the clock ticks every minute;
	// `today` rides the same clock so it rolls over at Bangkok midnight with the page open.
	const { now } = createMinuteClock();
	const today = $derived(todayDateString(now));
	const volunteerById = $derived(new Map((volunteersQuery.data ?? []).map((v) => [v._id, v])));
	// People are counted once however many shifts they applied for or were assigned to; the
	// other tiles count shifts (#716).
	const counts = $derived(
		summaryQuery.data?.counts ?? {
			people: 0,
			pending: 0,
			confirmed: 0,
			declined: 0,
			staffAssigned: 0
		}
	);

	// Filters narrow the lists only; the tiles above keep counting everything (#849).
	let statusFilter = $state<ApplicantStatusFilter>('all');
	let shiftChoice = $state('all'); // 'all' | 'today' | a `job.shifts[].id`
	let search = $state('');
	let attendanceFilter = $state<ApplicantAttendanceFilter>('all');

	const STATUS_OPTIONS: { value: ApplicantStatusFilter; label: string }[] = [
		{ value: 'all', label: 'ทุกสถานะการพิจารณา' },
		{ value: 'pending', label: 'รอพิจารณา' },
		{ value: 'confirmed', label: 'อนุมัติแล้ว' },
		{ value: 'declined', label: 'ปฏิเสธ/ยกเลิก' },
		{ value: 'staff', label: 'มอบหมายโดยเจ้าหน้าที่' }
	];
	const ATTENDANCE_OPTIONS: { value: ApplicantAttendanceFilter; label: string }[] = [
		{ value: 'all', label: 'ทุกสถานะการเข้างาน' },
		{ value: 'not_checked_in', label: 'ยังไม่เช็คอิน' },
		{ value: 'awaiting_confirmation', label: 'รอยืนยันการเข้างาน' },
		{ value: 'working', label: 'กำลังปฏิบัติงาน' },
		{ value: 'completed', label: 'เสร็จสิ้น' }
	];
	const shiftOptions = $derived([
		{ value: 'all', label: 'ทุกกะ / ทุกวัน' },
		{ value: 'today', label: 'วันนี้' },
		...job.shifts.map((s, i) => ({
			value: s.id,
			label: `กะย่อย #${i + 1} · ${formatThaiShortDate(s.date)} ${s.start_time}-${s.end_time}`
		}))
	]);
	const shiftCriterion = $derived.by(() => {
		if (shiftChoice === 'today') return { id: null, date: today };
		const shift = job.shifts.find((s) => s.id === shiftChoice);
		return shift ? { id: shift.id, date: shift.date } : null;
	});
	const filters = $derived({
		status: statusFilter,
		shift: shiftCriterion,
		search,
		attendance: attendanceFilter
	});
	const filtersActive = $derived(hasActiveApplicantFilters(filters));

	// Each list is one DB page of PAGE_SIZE. The bookmarks seen so far are kept per list and per
	// filter choice, so changing a filter starts again at page 1 without any reset code.
	const PAGE_SIZE = 20;
	type Section = 'pending' | 'reviewed' | 'staff';
	let pagers = $state<Record<string, { marks: (string | null)[]; index: number }>>({});
	const pagerKey = (section: Section) => `${section}|${statusFilter}|${shiftChoice}`;
	const pagerOf = (section: Section) => pagers[pagerKey(section)] ?? { marks: [null], index: 0 };
	function goNext(section: Section, bookmark: string | null) {
		const pager = pagerOf(section);
		pagers[pagerKey(section)] = {
			marks: [...pager.marks.slice(0, pager.index + 1), bookmark],
			index: pager.index + 1
		};
	}
	function goPrev(section: Section) {
		const pager = pagerOf(section);
		pagers[pagerKey(section)] = { ...pager, index: Math.max(0, pager.index - 1) };
	}

	// Pending applications have no attendance to match, so any attendance filter hides them.
	const showPending = $derived(
		(statusFilter === 'all' || statusFilter === 'pending') && attendanceFilter === 'all'
	);
	const showReviewed = $derived(
		statusFilter === 'all' || statusFilter === 'confirmed' || statusFilter === 'declined'
	);
	const showStaff = $derived(
		statusFilter === 'all' || statusFilter === 'staff' || statusFilter === 'declined'
	);
	const reviewedStatuses = $derived(
		statusFilter === 'confirmed'
			? (['confirmed'] as const)
			: statusFilter === 'declined'
				? (['rejected', 'cancelled'] as const)
				: (['confirmed', 'rejected', 'cancelled'] as const)
	);

	const pendingQuery = useJobApplicationPage(
		() => ({
			jobId: job._id,
			statuses: ['pending_review'],
			shift: shiftCriterion,
			bookmark: pagerOf('pending').marks[pagerOf('pending').index],
			limit: PAGE_SIZE
		}),
		() => showPending
	);
	const reviewedQuery = useJobApplicationPage(
		() => ({
			jobId: job._id,
			statuses: reviewedStatuses,
			shift: shiftCriterion,
			bookmark: pagerOf('reviewed').marks[pagerOf('reviewed').index],
			limit: PAGE_SIZE
		}),
		() => showReviewed
	);

	// Staff-assigned rows are what no confirmed application accounts for, so the summary (which
	// sees every application and assignment of the job) names them; only this page's documents
	// are then read.
	const staffRows = $derived(
		(summaryQuery.data?.staff ?? []).filter((a) => {
			if (statusFilter === 'staff' && a.status === 'cancelled') return false;
			if (statusFilter === 'declined' && a.status !== 'cancelled') return false;
			const crit = shiftCriterion;
			if (!crit) return true;
			return crit.id && a.shift_id ? crit.id === a.shift_id : crit.date === a.date;
		})
	);
	const staffIds = $derived(
		showStaff
			? staffRows
					.slice(pagerOf('staff').index * PAGE_SIZE, (pagerOf('staff').index + 1) * PAGE_SIZE)
					.map((a) => a._id)
			: []
	);
	const staffQuery = useStaffAssignmentPage(() => staffIds);
	const staffDocs = $derived.by(() => {
		const byId = new Map((staffQuery.data ?? []).map((a) => [a._id, a]));
		return staffIds.map((id) => byId.get(id)).filter((a) => a !== undefined);
	});

	const pendingItems = $derived(showPending ? (pendingQuery.data?.items ?? []) : []);
	const reviewedItems = $derived(showReviewed ? (reviewedQuery.data?.items ?? []) : []);

	// The check-in actions on a row need that volunteer's assignments; read just those.
	const pageVolunteerIds = $derived.by(() => {
		const ids = [
			...[...pendingItems, ...reviewedItems].map((a) => a.volunteer_id),
			...staffDocs.map((a) => a.volunteer_id)
		].filter((id): id is string => !!id);
		return ids.filter((id, i) => ids.indexOf(id) === i).sort();
	});
	const assignmentsQuery = useVolunteerPageAssignments(
		() => job._id,
		() => pageVolunteerIds
	);
	const assignments = $derived(assignmentsQuery.data ?? []);

	const view = $derived(
		filterApplicantBoard(
			{
				pending: groupApplicationsByApplicant(pendingItems),
				history: [
					...reviewedItems.map((a) => applicationEntry(a, volunteerById)),
					...staffDocs.map((a) => staffEntry(a, volunteerById))
				].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt) || a.key.localeCompare(b.key))
			},
			{ status: 'all', shift: null, search, attendance: attendanceFilter },
			{ assignments, volunteers: volunteerById, today, now }
		)
	);
	const reviewedView = $derived(view.history.filter((e) => e.kind === 'application'));
	const staffView = $derived(view.history.filter((e) => e.kind === 'staff'));
	const viewPendingShifts = $derived(view.pending.reduce((n, g) => n + g.applications.length, 0));
	const viewHistory = $derived(historyBreakdown(view.history));
	const listsLoading = $derived(
		(showPending && pendingQuery.isPending) ||
			(showReviewed && reviewedQuery.isPending) ||
			(showStaff && staffIds.length > 0 && staffQuery.isPending)
	);

	function clearFilters() {
		statusFilter = EMPTY_APPLICANT_FILTERS.status;
		shiftChoice = 'all';
		search = EMPTY_APPLICANT_FILTERS.search;
		attendanceFilter = EMPTY_APPLICANT_FILTERS.attendance;
	}

	const selectTriggerClass = 'h-10 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs';

	const tiles = $derived([
		{
			key: 'total',
			status: 'all' as ApplicantStatusFilter,
			label: 'ผู้สมัครทั้งหมด',
			value: counts.people,
			unit: 'คน',
			tone: 'border-border bg-card'
		},
		{
			key: 'pending',
			status: 'pending' as ApplicantStatusFilter,
			label: 'รอพิจารณา',
			value: counts.pending,
			unit: 'กะ',
			tone: 'border-border bg-muted/50'
		},
		{
			key: 'confirmed',
			status: 'confirmed' as ApplicantStatusFilter,
			label: 'อนุมัติใบสมัครแล้ว',
			value: counts.confirmed,
			unit: 'กะ',
			tone: 'border-emerald-200 bg-emerald-50/70'
		},
		{
			key: 'declined',
			status: 'declined' as ApplicantStatusFilter,
			label: '✕ ปฏิเสธ/ยกเลิก',
			value: counts.declined,
			unit: 'กะ',
			tone: 'border-rose-200 bg-rose-50/70'
		},
		{
			key: 'staff',
			status: 'staff' as ApplicantStatusFilter,
			label: 'มอบหมายโดยเจ้าหน้าที่',
			value: counts.staffAssigned,
			unit: 'กะ',
			tone: 'border-sky-200 bg-sky-50/70'
		}
	]);

	/**
	 * `job.shifts` position for an application's chosen slot — the application
	 * stores the concrete `shift_id` plus a date/time snapshot, so the label
	 * is a best-effort match and is simply omitted when nothing lines up.
	 */
	function shiftLabelFor(application: JobApplication): string | null {
		const index = job.shifts.findIndex(
			(s) =>
				s.date === application.selected_shift.date &&
				s.start_time === application.selected_shift.start_time &&
				s.end_time === application.selected_shift.end_time
		);
		return index === -1 ? null : `กะย่อย #${index + 1}`;
	}

	function volunteerFor(application: JobApplication) {
		return application.volunteer_id ? (volunteerById.get(application.volunteer_id) ?? null) : null;
	}

	/** The job's sub-shift a staff assignment points at, or `null` for a legacy/deleted one. */
	function staffShiftFor(shiftId: string | null) {
		const index = shiftId ? job.shifts.findIndex((s) => s.id === shiftId) : -1;
		if (index === -1) return null;
		const { start_time, end_time } = job.shifts[index];
		return { label: `กะย่อย #${index + 1}`, start_time, end_time };
	}

	let reviewOpen = $state(false);
	let reviewTargets = $state<JobApplication[]>([]);
	let reviewDecision = $state<'confirmed' | 'rejected'>('confirmed');

	function openReview(applications: JobApplication[], decision: 'confirmed' | 'rejected') {
		reviewTargets = applications;
		reviewDecision = decision;
		reviewOpen = true;
	}

	const reviewVolunteerId = $derived(reviewTargets[0]?.volunteer_id ?? null);
</script>

<div class="space-y-4">
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
		{#each tiles as tile (tile.key)}
			<button
				type="button"
				aria-pressed={statusFilter === tile.status}
				onclick={() => (statusFilter = tile.status)}
				class={[
					'rounded-2xl border p-3.5 text-left transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
					statusFilter === tile.status && 'ring-2 ring-primary',
					tile.tone
				]}
			>
				<span class="block text-xs font-medium text-muted-foreground">{tile.label}</span>
				<span class="mt-1 block text-2xl font-bold text-foreground tabular-nums"
					>{tile.value} {tile.unit}</span
				>
			</button>
		{/each}
	</div>

	<div class="rounded-2xl border border-border bg-card p-4 shadow-xs">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h3 class="inline-flex items-center gap-2 text-sm font-bold text-foreground">
				<Users class="h-4 w-4 text-primary" />
				รายชื่อและสถานะผู้สมัครงานอาสานี้
			</h3>
		</div>

		{#if loading}
			<div class="mt-3 space-y-3">
				<Skeleton class="h-32 w-full rounded-xl" />
				<Skeleton class="h-32 w-full rounded-xl" />
			</div>
		{:else if counts.people === 0}
			<div
				class="mt-3 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center text-muted-foreground"
			>
				<Users class="h-8 w-8" />
				<p class="text-sm font-medium">ยังไม่มีผู้สมัครงานนี้</p>
				<p class="max-w-md text-xs">
					เมื่อมีผู้สมัครเข้ามา รายชื่อจะขึ้นที่นี่เพื่อรอการอนุมัติ หรือกด "มอบหมายงานให้อาสา"
					เพื่อดึงอาสาในทะเบียนเข้ากะโดยตรง
				</p>
			</div>
		{:else}
			<div class="mt-3 space-y-2">
				<span id="applicant-filter-search" class="block text-xs font-medium text-muted-foreground"
					>ค้นหาผู้สมัคร</span
				>
				<div class="relative">
					<Search
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="search"
						placeholder="ค้นหาชื่อ นามสกุล ชื่อเล่น เบอร์โทร, รหัส V-xxx"
						aria-labelledby="applicant-filter-search"
						bind:value={search}
						class="h-10 rounded-xl bg-background pl-9 shadow-xs"
					/>
				</div>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
					<div class="min-w-0 space-y-1">
						<span
							id="applicant-filter-status"
							class="block text-xs font-medium text-muted-foreground"
							>สถานะการพิจารณา (เจ้าหน้าที่)</span
						>
						<Select.Root type="single" bind:value={statusFilter}>
							<Select.Trigger class={selectTriggerClass} aria-labelledby="applicant-filter-status">
								<span class="truncate">
									{STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each STATUS_OPTIONS as opt (opt.value)}
									<Select.Item value={opt.value} label={opt.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="min-w-0 space-y-1">
						<span
							id="applicant-filter-shift"
							class="block text-xs font-medium text-muted-foreground">กะ / วันที่</span
						>
						<Select.Root type="single" bind:value={shiftChoice}>
							<Select.Trigger class={selectTriggerClass} aria-labelledby="applicant-filter-shift">
								<span class="truncate">
									{(shiftOptions.find((o) => o.value === shiftChoice) ?? shiftOptions[0]).label}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each shiftOptions as opt (opt.value)}
									<Select.Item value={opt.value} label={opt.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="min-w-0 space-y-1">
						<span
							id="applicant-filter-attendance"
							class="block text-xs font-medium text-muted-foreground"
							>สถานะการเข้างาน (เช็คอิน)</span
						>
						<Select.Root type="single" bind:value={attendanceFilter}>
							<Select.Trigger
								class={selectTriggerClass}
								aria-labelledby="applicant-filter-attendance"
							>
								<span class="truncate">
									{ATTENDANCE_OPTIONS.find((o) => o.value === attendanceFilter)?.label}
								</span>
							</Select.Trigger>
							<Select.Content>
								{#each ATTENDANCE_OPTIONS as opt (opt.value)}
									<Select.Item value={opt.value} label={opt.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
				{#if filtersActive}
					<Button type="button" variant="outline" size="sm" onclick={clearFilters}>
						ล้างตัวกรอง
					</Button>
				{/if}
			</div>

			{#if listsLoading}
				<div class="mt-4 space-y-3">
					<Skeleton class="h-32 w-full rounded-xl" />
					<Skeleton class="h-32 w-full rounded-xl" />
				</div>
			{:else if view.pending.length === 0 && view.history.length === 0}
				<div
					class="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-center text-muted-foreground"
				>
					<Search class="h-6 w-6" />
					<p class="text-sm font-medium">ไม่พบผู้สมัครตามตัวกรอง</p>
				</div>
			{/if}

			{#if view.pending.length > 0}
				<div class="mt-4 flex items-center justify-between gap-3">
					<h4 class="text-xs font-bold text-foreground">
						รอพิจารณา ({view.pending.length} คน · {viewPendingShifts} กะในหน้านี้)
					</h4>
					<span class="text-2xs text-muted-foreground">เรียงตามวันที่สมัคร</span>
				</div>
				<ul class="mt-3 space-y-3">
					{#each view.pending as group (group.key)}
						{@const volunteer = volunteerFor(group.applications[0])}
						<JobApplicantRow
							applications={group.applications}
							{volunteer}
							volunteerCode={volunteer?.volunteer_code ?? null}
							shiftLabelOf={shiftLabelFor}
							requiredSkills={job.skills_required ?? []}
							skillOptions={skillCatalog.options}
							{assignments}
							{today}
							onreview={openReview}
							accessStatus={volunteer ? volunteerAccessStatus(volunteer, accounts) : null}
							{shelterLine}
						/>
					{/each}
				</ul>
			{/if}
			{#if showPending}
				<BookmarkPager
					page={pagerOf('pending').index + 1}
					hasNext={(pendingQuery.data?.items.length ?? 0) === PAGE_SIZE}
					pending={pendingQuery.isFetching}
					onprev={() => goPrev('pending')}
					onnext={() => goNext('pending', pendingQuery.data?.bookmark ?? null)}
				/>
			{/if}

			{#if reviewedView.length > 0}
				<div class="mt-6 border-t border-border pt-4">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h4 class="text-xs font-bold text-foreground">ประวัติการพิจารณา</h4>
						<span class="text-2xs text-muted-foreground">
							ในหน้านี้: อนุมัติ {viewHistory.confirmed} · ปฏิเสธ/ยกเลิก {viewHistory.declined}
						</span>
					</div>
					<ul class="mt-3 space-y-3">
						{#each reviewedView as entry (entry.key)}
							{#if entry.kind === 'application'}
								<JobApplicantRow
									applications={[entry.application]}
									volunteer={entry.volunteer}
									volunteerCode={entry.person.code}
									shiftLabelOf={shiftLabelFor}
									requiredSkills={job.skills_required ?? []}
									skillOptions={skillCatalog.options}
									{assignments}
									{today}
									onreview={openReview}
									accessStatus={entry.volunteer
										? volunteerAccessStatus(entry.volunteer, accounts)
										: null}
									{shelterLine}
								/>
							{/if}
						{/each}
					</ul>
				</div>
			{/if}
			{#if showReviewed}
				<BookmarkPager
					page={pagerOf('reviewed').index + 1}
					hasNext={(reviewedQuery.data?.items.length ?? 0) === PAGE_SIZE}
					pending={reviewedQuery.isFetching}
					onprev={() => goPrev('reviewed')}
					onnext={() => goNext('reviewed', reviewedQuery.data?.bookmark ?? null)}
				/>
			{/if}

			{#if staffView.length > 0}
				<div class="mt-6 border-t border-border pt-4">
					<h4 class="text-xs font-bold text-foreground">
						มอบหมายโดยเจ้าหน้าที่ ({staffRows.length} กะ)
					</h4>
					<ul class="mt-3 space-y-3">
						{#each staffView as entry (entry.key)}
							{#if entry.kind === 'staff'}
								<StaffAssignmentRow {entry} shift={staffShiftFor(entry.shiftId)} {today} />
							{/if}
						{/each}
					</ul>
				</div>
			{/if}
			{#if showStaff}
				<BookmarkPager
					page={pagerOf('staff').index + 1}
					hasNext={(pagerOf('staff').index + 1) * PAGE_SIZE < staffRows.length}
					pending={staffQuery.isFetching}
					onprev={() => goPrev('staff')}
					onnext={() => goNext('staff', null)}
				/>
			{/if}
		{/if}
	</div>

	<JobApplicantReviewDialog
		bind:open={reviewOpen}
		{job}
		applications={reviewTargets}
		volunteer={reviewVolunteerId ? (volunteerById.get(reviewVolunteerId) ?? null) : null}
		decision={reviewDecision}
	/>
</div>

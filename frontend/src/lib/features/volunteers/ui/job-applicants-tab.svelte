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
	 * Every list is read from an UNFILTERED query and narrowed here with
	 * `buildApplicantBoard`. `useJobApplications(filter)` takes its filter
	 * once at setup, so a `{ jobId }` filter would freeze to whichever job was
	 * rendered first (SvelteKit reuses this component across `[id]`
	 * navigations) — and sharing the unfiltered cache entry with the tab badge
	 * means the badge and this list can never disagree. Shift assignments (for the
	 * per-shift check-in action) are read the same unfiltered way.
	 */
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { formatThaiShortDate } from '$lib/utils/date';
	import JobApplicantRow from './job-applicant-row.svelte';
	import JobApplicantReviewDialog from './job-applicant-review-dialog.svelte';
	import StaffAssignmentRow from './staff-assignment-row.svelte';
	import { buildApplicantBoard, historyBreakdown } from '../domain/applicant-board';
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
		useJobApplications,
		useShiftAssignments,
		useSkillOptions,
		useVolunteers
	} from '../application/queries';

	let { job }: { job: Job } = $props();

	const applicationsQuery = useJobApplications();
	const volunteersQuery = useVolunteers();
	const assignmentsQuery = useShiftAssignments();
	const skillCatalog = useSkillOptions();

	const loading = $derived(
		applicationsQuery.isPending || assignmentsQuery.isPending || volunteersQuery.isPending
	);
	const assignments = $derived(assignmentsQuery.data ?? []);
	const today = $derived(todayDateString());
	const volunteerById = $derived(new Map((volunteersQuery.data ?? []).map((v) => [v._id, v])));
	const board = $derived(
		buildApplicantBoard({
			jobId: job._id,
			applications: applicationsQuery.data ?? [],
			assignments,
			volunteers: volunteerById
		})
	);
	// People are counted once however many shifts they applied for or were assigned to; the
	// other tiles count shifts (#716).
	const counts = $derived(board.counts);

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
	const view = $derived(
		filterApplicantBoard(board, filters, {
			assignments,
			volunteers: volunteerById,
			today,
			now: new Date()
		})
	);
	const viewPendingShifts = $derived(view.pending.reduce((n, g) => n + g.applications.length, 0));
	const viewHistory = $derived(historyBreakdown(view.history));

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
						placeholder="ค้นหาชื่อ นามสกุล เบอร์โทร, รหัส V-xxx"
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

			{#if view.pending.length === 0 && view.history.length === 0}
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
						รอพิจารณา ({view.pending.length} คน · {viewPendingShifts} กะ)
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
						/>
					{/each}
				</ul>
			{/if}

			{#if view.history.length > 0}
				<div class="mt-6 border-t border-border pt-4">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h4 class="text-xs font-bold text-foreground">ประวัติ ({view.history.length} กะ)</h4>
						<span class="text-2xs text-muted-foreground">
							อนุมัติ {viewHistory.confirmed} · ปฏิเสธ/ยกเลิก {viewHistory.declined} · มอบหมายโดยเจ้าหน้าที่
							{viewHistory.staffAssigned}
						</span>
					</div>
					<ul class="mt-3 space-y-3">
						{#each view.history as entry (entry.key)}
							{#if entry.kind === 'staff'}
								<StaffAssignmentRow {entry} shift={staffShiftFor(entry.shiftId)} {today} />
							{:else}
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
								/>
							{/if}
						{/each}
					</ul>
				</div>
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

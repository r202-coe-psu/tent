<script lang="ts">
	/**
	 * `/back-office/volunteers/jobs/[id]/assign` — assign volunteers to one
	 * sub-shift of a job (CR-094 FR-VOL-09, approved mockup 2026-08-28).
	 *
	 * A full page rather than a dialog (owner decision 2026-08-28): the roster
	 * is a working surface — search, three filter groups, multi-select over a
	 * long list — and it deep-links, so an SM can hand someone the URL of the
	 * shift that still needs people.
	 *
	 * Every decision this screen renders comes from pure domain code:
	 *   - row state / filters / counts → `domain/assign-roster.ts`
	 *   - the selected shift's exact headcount → `domain/shift-roster.ts`
	 *   - the UTC duty window written  → `domain/duty-window.ts#shiftDutyWindow`
	 * Nothing here recomputes eligibility, collisions or capacity inline.
	 *
	 * There is NO offer/accept step (owner decision 2026-08-29): the SM assigns
	 * outright. `useAssignVolunteers` → `ShiftAssignmentRepository#assign`
	 * creates the assignment already accepted AND moves
	 * the job counters from the concrete shift assignments in the same call,
	 * retrying on CouchDB 409. The calls are sequential on purpose — they all
	 * read-modify-write the same job document, so firing them in parallel would
	 * just make every one of them conflict and retry.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Search from '@lucide/svelte/icons/search';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Target from '@lucide/svelte/icons/target';
	import Timer from '@lucide/svelte/icons/timer';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Check from '@lucide/svelte/icons/check';
	import UserRoundPlus from '@lucide/svelte/icons/user-round-plus';
	import Send from '@lucide/svelte/icons/send';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { useShelter } from '$lib/features/shelters';
	import { errorMessage } from '$lib/utils/errors';
	import AssignRosterRow from './assign-roster-row.svelte';
	import AssignVolunteerDetailDialog from './assign-volunteer-detail-dialog.svelte';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';
	import { shiftDutyWindow } from '../domain/duty-window';
	import { assignmentCountForShift } from '../domain/shift-roster';
	import {
		planBulkAssign,
		skipReasonText,
		summarizeBulk,
		type BulkOutcome,
		type BulkRunSummary
	} from '../domain/bulk-assign';
	import type { JobShift } from '../domain/job.schema';
	import {
		buildAssignRoster,
		countAssignable,
		filterAssignRoster,
		shiftKindFor,
		type AvailabilityFilter,
		type EligibilityFilter,
		type SkillFilter,
		type AssignCandidate
	} from '../domain/assign-roster';
	import {
		useAssignVolunteers,
		useJob,
		useJobs,
		useShiftAssignments,
		useSkillOptions,
		useVolunteers
	} from '../application/queries';

	let {
		jobId,
		/** `?shift=` deep link — preselects one sub-shift. */
		shiftId
	}: {
		jobId: string;
		shiftId?: string;
	} = $props();

	const queryClient = useQueryClient();
	const assignMutation = useAssignVolunteers(queryClient);

	/**
	 * The lists are fetched unfiltered on purpose. `useVolunteers(filter)` & co.
	 * capture their filter once at setup, so a filter derived from the selected
	 * shift would freeze to whichever shift rendered first. Narrowing happens
	 * below, against the live selection.
	 */
	const jobQuery = useJob(() => jobId);
	const skillCatalog = useSkillOptions();
	const volunteersQuery = useVolunteers();
	const assignmentsQuery = useShiftAssignments();
	const jobsQuery = useJobs();

	const job = $derived(jobQuery.data ?? null);
	const shelterQuery = useShelter(() => job?.shelter_code ?? '');
	const shelterLabel = $derived(shelterQuery.data?.name ?? job?.shelter_code ?? '—');

	/**
	 * `resolve()` in this SvelteKit version only prefixes `base`, so the `[id]`
	 * segment is built here — `jobId` contains a colon (`job:01J…`), hence the
	 * encode (same as `job-card.svelte`).
	 */
	function backToDetail() {
		goto(resolve(`/back-office/volunteers/jobs/${encodeURIComponent(jobId)}`));
	}

	/**
	 * Keep the shift picker chronological, matching `job-shifts-tab.svelte`.
	 */
	const orderedShifts = $derived(
		[...(job?.shifts ?? [])].sort((a, b) =>
			`${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`)
		)
	);
	/**
	 * `job.slots_confirmed` and `job.slots_dispatched` are totals for the whole
	 * job. They cannot be projected into a concrete shift by array position:
	 * an offer on another shift would make this shift look full. This page uses
	 * the exact shift roster instead.
	 */
	const assignedByShiftId = $derived.by<Map<string, number>>(() => {
		const assignments = assignmentsQuery.data ?? [];
		if (!job) return new Map();
		return new Map(
			orderedShifts.map((candidate) => [
				candidate.id,
				assignmentCountForShift(candidate, job._id, assignments)
			])
		);
	});

	/**
	 * Explicit user selection of shifts. Null while untouched — in that state,
	 * `defaultShiftId` derives the first available non-full shift.
	 */
	let pickedShiftIds = $state<string[] | null>(null);
	let focusedShiftId = $state<string>('');

	const defaultShiftId = $derived.by(() => {
		if (orderedShifts.length === 0) return '';
		const candidate = shiftId ? orderedShifts.find((s) => s.id === shiftId) : undefined;
		const candidateAssigned = candidate ? (assignedByShiftId.get(candidate.id) ?? 0) : 0;
		const candidateFull =
			candidate && candidate.quota > 0 ? candidateAssigned >= candidate.quota : true;
		if (candidate && !candidateFull) return candidate.id;

		const available = orderedShifts.find((s) => {
			const assigned = assignedByShiftId.get(s.id) ?? 0;
			return s.quota - assigned > 0;
		});
		return available?.id ?? '';
	});

	const selectedShiftIds = $derived(
		pickedShiftIds !== null ? pickedShiftIds : defaultShiftId ? [defaultShiftId] : []
	);

	const targetShifts = $derived(orderedShifts.filter((s) => selectedShiftIds.includes(s.id)));
	const multiShift = $derived(targetShifts.length > 1);
	const activeShiftId = $derived(
		focusedShiftId && selectedShiftIds.includes(focusedShiftId)
			? focusedShiftId
			: (targetShifts[0]?.id ?? '')
	);
	const activeIndex = $derived(orderedShifts.findIndex((s) => s.id === activeShiftId));
	const shift = $derived(activeIndex >= 0 ? orderedShifts[activeIndex] : null);

	function shiftLabel(s: JobShift): string {
		const crossesMidnight = s.end_date !== s.date;
		return (
			`${s.date} | ${s.start_time} - ${s.end_time} น.${crossesMidnight ? ` (ถึง ${s.end_date})` : ''}` +
			` (${assignedByShiftId.get(s.id) ?? 0}/${s.quota} คน)`
		);
	}

	// — filters & selection ————————————————————————————————————————————————
	let search = $state('');
	let skillFilter = $state<SkillFilter>('all');
	let availabilityFilter = $state<AvailabilityFilter>('all');
	let eligibilityFilter = $state<EligibilityFilter>('all');
	let selectedIds = $state<string[]>([]);
	let detailCandidate = $state<AssignCandidate | null>(null);
	let detailOpen = $state(false);

	const loading = $derived(
		jobQuery.isLoading ||
			volunteersQuery.isLoading ||
			assignmentsQuery.isLoading ||
			jobsQuery.isLoading
	);

	const jobsById = $derived(new Map((jobsQuery.data ?? []).map((j) => [j._id, j])));

	/**
	 * A shift crossing midnight has assignments filed under both calendar
	 * dates; `collision.ts` compares instants, but narrowing the list first
	 * keeps the per-keystroke work small.
	 */
	const relevantAssignments = $derived(
		shift
			? (assignmentsQuery.data ?? []).filter(
					(a) => a.date === shift.date || a.date === shift.end_date
				)
			: []
	);

	/**
	 * `shiftDutyWindow` throws on a malformed stored shift rather than
	 * returning a window that would silently mark everyone "available" — catch
	 * it here and show the error instead of an empty, misleading roster.
	 */
	const roster = $derived.by(
		(): { rows: ReturnType<typeof buildAssignRoster>; error: string | null } => {
			if (!job) return { rows: [], error: null };
			if (!shift) {
				const hasAnyShifts = (job.shifts ?? []).length > 0;
				return {
					rows: [],
					error: hasAnyShifts ? 'กรุณาเลือกอย่างน้อย 1 กะ' : 'งานนี้ยังไม่มีกะย่อย'
				};
			}
			try {
				return {
					rows: buildAssignRoster({
						job,
						shift,
						volunteers: volunteersQuery.data ?? [],
						assignments: relevantAssignments,
						jobsById,
						// CR-100 — the job stores master skill codes, `volunteer.skills`
						// stores labels; the catalog is what lets the two match.
						skillOptions: skillCatalog.options,
						controlledSkills: skillCatalog.controlledValues
					}),
					error: null
				};
			} catch (err) {
				return {
					rows: [],
					error: err instanceof Error ? err.message : 'กะนี้มีวันหรือเวลาไม่ถูกต้อง'
				};
			}
		}
	);

	const requiredSkills = $derived(job?.skills_required ?? []);
	const hasJobSkills = $derived(requiredSkills.length > 0);
	const jobSkills = $derived.by<SkillOption[]>(() => {
		if (requiredSkills.length === 0) return [];
		const map = new SvelteMap<string, SkillOption>();
		for (const code of requiredSkills) {
			const option = resolveSkillOption(code, skillCatalog.options);
			if (option && !map.has(option.code)) {
				map.set(option.code, option);
			}
		}
		return Array.from(map.values());
	});

	const matchedCandidateCount = $derived(roster.rows.filter((r) => r.skillMatch).length);

	const visible = $derived(
		filterAssignRoster(roster.rows, {
			search,
			skill: skillFilter,
			availability: availabilityFilter,
			eligibility: eligibilityFilter
		})
	);
	/**
	 * Two visually separate groups (owner feedback 2026-09-02): volunteers who
	 * already hold a seat on THIS sub-shift vs everyone still unassigned.
	 * Grouping only — `assign-roster.ts` decided each row's state; the
	 * on-shift group is read-only because those rows are never `assignable`.
	 */
	const onShift = $derived(visible.filter((c) => c.state.kind === 'accepted'));
	const unassigned = $derived(visible.filter((c) => c.state.kind !== 'accepted'));
	const assignableCount = $derived(countAssignable(visible));
	const selectedCount = $derived(
		visible.filter((c) => c.assignable && selectedIds.includes(c.volunteer._id)).length
	);
	const allSelected = $derived(assignableCount > 0 && selectedCount === assignableCount);

	const PAGE_SIZE = 10;
	let currentPage = $state(1);

	$effect(() => {
		void search;
		void skillFilter;
		void availabilityFilter;
		void eligibilityFilter;
		currentPage = 1;
	});

	const unassignedTotal = $derived(unassigned.length);
	const totalPages = $derived(Math.max(1, Math.ceil(unassignedTotal / PAGE_SIZE)));
	const safePage = $derived(Math.max(1, Math.min(currentPage, totalPages)));
	const paginatedUnassigned = $derived(
		unassigned.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
	);

	const activeAssignedCount = $derived(shift ? (assignedByShiftId.get(shift.id) ?? 0) : 0);
	const remaining = $derived(Math.max((shift?.quota ?? 0) - activeAssignedCount, 0));
	// — several shifts at once (#1164) ——————————————————————————————————————————
	/** The result of the last multi-shift run that left someone out: a dialog, never off-screen. */
	let bulkResult = $state<BulkRunSummary | null>(null);
	let bulkResultOpen = $state(false);

	function toggleShift(s: JobShift) {
		const assigned = assignedByShiftId.get(s.id) ?? 0;
		const isFull = s.quota > 0 && assigned >= s.quota;
		if (isFull) return;

		const current = [...selectedShiftIds];
		if (current.includes(s.id) && current.length === 1) {
			toast.error('ต้องเลือกอย่างน้อย 1 กะ');
			return;
		}
		const next = current.includes(s.id) ? current.filter((id) => id !== s.id) : [...current, s.id];

		pickedShiftIds = next;
		if (next.includes(s.id)) {
			focusedShiftId = s.id;
		} else if (focusedShiftId === s.id) {
			focusedShiftId = next[0] ?? '';
		}

		selectedIds = [];
		currentPage = 1;
		detailCandidate = null;
		detailOpen = false;
		bulkResult = null;
		bulkResultOpen = false;
	}

	// With several shifts a full one is skipped and reported, so only a single shift is gated here.
	const overCapacity = $derived(!multiShift && selectedCount > remaining);
	const sending = $derived(assignMutation.isPending);
	let bulkProgress = $state<{ current: number; total: number } | null>(null);

	/**
	 * Place the chosen people in every target shift. A pair that cannot go through (already there,
	 * clashes, shift full, or the save fails) is skipped and listed; the rest are saved.
	 */
	async function assignAcrossShifts(chosen: AssignCandidate[]) {
		if (!job || sending || chosen.length === 0 || targetShifts.length === 0) return;
		const plan = planBulkAssign({
			job,
			shifts: targetShifts,
			volunteers: chosen.map((c) => c.volunteer),
			assignments: assignmentsQuery.data ?? [],
			jobsById,
			skillOptions: skillCatalog.options,
			controlledSkills: skillCatalog.controlledValues
		});
		const outcomes: BulkOutcome[] = plan.skipped.map((skip) => ({
			shift: skip.shift,
			volunteer: skip.volunteer,
			ok: false,
			why: skipReasonText(skip.reason)
		}));
		// Only a failed save is worth retrying; a rule that said no will say no again.
		const failedSave: string[] = [];
		const fullShiftIds = new SvelteSet<string>();
		const total = plan.assign.length;
		let processed = 0;
		bulkProgress = { current: 0, total };

		try {
			for (const item of plan.assign) {
				bulkProgress = { current: processed + 1, total };
				if (fullShiftIds.has(item.shift.id)) {
					outcomes.push({
						shift: item.shift,
						volunteer: item.volunteer,
						ok: false,
						why: 'กะนี้เต็มแล้ว'
					});
					processed += 1;
					continue;
				}
				try {
					await assignMutation.mutateAsync({
						job_id: job._id,
						shift_id: item.shift.id,
						volunteer_id: item.volunteer._id,
						date: item.shift.date,
						shift: item.shiftKind,
						// The job is the posting, so its title is the station (as for a single shift).
						station: job.title,
						duty_window: item.dutyWindow
					});
					outcomes.push({ shift: item.shift, volunteer: item.volunteer, ok: true });
				} catch (err) {
					const isQuota = err instanceof Error && /quota|โควตา|เต็ม|capacity/i.test(err.message);
					if (isQuota) {
						fullShiftIds.add(item.shift.id);
					}
					outcomes.push({
						shift: item.shift,
						volunteer: item.volunteer,
						ok: false,
						why: isQuota ? 'กะนี้เต็มแล้ว' : `บันทึกไม่สำเร็จ (${errorMessage(err)})`
					});
					failedSave.push(item.volunteer._id);
				}
				processed += 1;
			}
		} finally {
			bulkProgress = null;
		}
		selectedIds = selectedIds.filter((id) => failedSave.includes(id));
		const summary = summarizeBulk(
			chosen.map((c) => c.volunteer),
			outcomes
		);
		if (summary.notPlacedCount > 0) {
			bulkResult = summary;
			bulkResultOpen = true;
		} else {
			bulkResult = null;
			toast.success(
				`มอบหมายสำเร็จ ${summary.placedCount} รายการ (${chosen.length} คน × ${targetShifts.length} กะ)`
			);
		}
	}

	function openDetails(candidate: AssignCandidate) {
		detailCandidate = candidate;
		detailOpen = true;
	}

	function candidateShelterLabel(candidate: AssignCandidate): string {
		return candidate.volunteer.current_shelter_code &&
			candidate.volunteer.current_shelter_code !== job?.shelter_code
			? candidate.volunteer.current_shelter_code
			: shelterLabel;
	}

	function toggleOne(volunteerId: string, next: boolean) {
		selectedIds = next
			? [...selectedIds, volunteerId]
			: selectedIds.filter((id) => id !== volunteerId);
	}

	function toggleAll(next: boolean) {
		const ids = visible.filter((c) => c.assignable).map((c) => c.volunteer._id);
		selectedIds = next
			? [...new Set([...selectedIds, ...ids])]
			: selectedIds.filter((id) => !ids.includes(id));
	}

	async function assignCandidates(chosen: AssignCandidate[]): Promise<number> {
		if (!job || !shift || sending) return 0;
		if (chosen.length === 0) return 0;
		if (chosen.length > remaining) {
			toast.error(`กะนี้เหลือรับได้อีก ${remaining} คน แต่เลือกไว้ ${chosen.length} คน`);
			return 0;
		}

		let dutyWindow: ReturnType<typeof shiftDutyWindow>;
		try {
			dutyWindow = shiftDutyWindow(shift);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'กะนี้มีวันหรือเวลาไม่ถูกต้อง');
			return 0;
		}
		const kind = shiftKindFor(shift);
		/**
		 * `shift_assignment.station` is required (schema.md §2.9) but the
		 * approved mockup has no field for it — the job IS the posting, so the
		 * job title is recorded as the station. A per-assignment station needs
		 * its own UI (and a CR) if it is ever wanted.
		 */
		const station = job.title;

		const failed: string[] = [];
		const successfulIds: string[] = [];
		let sent = 0;
		for (const candidate of chosen) {
			try {
				await assignMutation.mutateAsync({
					job_id: job._id,
					shift_id: shift.id,
					volunteer_id: candidate.volunteer._id,
					date: shift.date,
					shift: kind,
					station,
					duty_window: dutyWindow
				});
				sent += 1;
				successfulIds.push(candidate.volunteer._id);
			} catch (err) {
				const name = `${candidate.volunteer.first_name} ${candidate.volunteer.last_name}`.trim();
				failed.push(`${name || candidate.volunteer._id} (${errorMessage(err)})`);
				// Quota is finite: once one dispatch fails there may be no seat
				// left, so stop rather than hammering the same document.
				if (err instanceof Error && /quota|โควตา|เต็ม|capacity/i.test(err.message)) break;
			}
		}

		// Keep failed candidates selected so the SM can see who still needs
		// attention and retry after fixing the underlying quota/data issue.
		selectedIds = selectedIds.filter((id) => !successfulIds.includes(id));
		if (sent > 0) toast.success(`มอบหมายอาสา ${sent} คนเข้ากะนี้แล้ว`);
		if (failed.length > 0)
			toast.error(`มอบหมายไม่สำเร็จ ${failed.length} คน: ${failed.join(', ')}`);
		return sent;
	}

	async function assignSelected() {
		const chosen = visible.filter((c) => c.assignable && selectedIds.includes(c.volunteer._id));
		if (multiShift) await assignAcrossShifts(chosen);
		else await assignCandidates(chosen);
	}

	async function assignOne(candidate: AssignCandidate) {
		if (!candidate.assignable) return;
		if (multiShift) {
			await assignAcrossShifts([candidate]);
			detailOpen = false;
		} else {
			const sent = await assignCandidates([candidate]);
			if (sent > 0) detailOpen = false;
		}
	}

	// `flex-1` at every breakpoint (not just mobile) so each segmented row
	// stretches to fill its grid column instead of shrinking to content width
	// and leaving dead space beside it (owner feedback 2026-08-31).
	// Segments wrap safely on small screens without blowing out containers or overflowing.
	const SEGMENT_BASE =
		'h-auto min-h-11 flex-auto shrink min-w-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:min-h-9 break-words text-center leading-snug whitespace-normal';
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button
			variant="outline"
			class="h-auto min-h-11 max-w-full gap-1.5 rounded-xl py-2 text-left text-xs whitespace-normal sm:min-h-9 sm:text-sm"
			onclick={backToDetail}
		>
			<ArrowLeft class="h-4 w-4 shrink-0" />
			ย้อนกลับไปหน้ารายละเอียดงานอาสาสมัคร
		</Button>
		<h1 class="inline-flex items-center gap-2 text-base font-bold sm:text-lg">
			<UserPlus class="h-5 w-5 text-primary" />
			มอบหมายอาสาเข้ากะ (Assign Volunteers)
		</h1>
	</div>

	{#if loading}
		<Skeleton class="h-40 w-full rounded-2xl" />
		<Skeleton class="h-24 w-full rounded-2xl" />
		<Skeleton class="h-72 w-full rounded-2xl" />
	{:else if !job}
		<p class="rounded-2xl border border-border bg-card py-16 text-center text-sm text-destructive">
			ไม่พบงานอาสาสมัครนี้ (อาจถูกลบไปแล้ว)
		</p>
	{:else}
		<!-- Job summary card -->
		<div class="rounded-2xl border border-border bg-card p-4 sm:p-5">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						งานอาสาสมัคร
					</p>
					<h2 class="text-lg font-bold text-foreground sm:text-xl">{job.title}</h2>
					<p class="mt-0.5 text-xs text-muted-foreground">ศูนย์: {shelterLabel}</p>
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						<span class="text-xs font-medium text-muted-foreground">ทักษะที่ต้องการ:</span>
						{#if jobSkills.length > 0}
							{#each jobSkills as s (s.code)}
								<span
									class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/20"
								>
									<Target class="size-3" />
									{s.label}
								</span>
							{/each}
						{:else}
							<span
								class="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
							>
								ไม่จำกัดทักษะ (รับทุกทักษะ)
							</span>
						{/if}
					</div>
				</div>
				{#if shift}
					<div class="flex flex-wrap items-center gap-2">
						<div class="rounded-xl bg-muted px-3 py-2 text-center">
							<p class="text-[11px] text-muted-foreground">เป้าหมายกะหลัก</p>
							<p class="text-base font-bold text-foreground tabular-nums">{shift.quota} คน</p>
						</div>
						<div class="rounded-xl bg-emerald-50 px-3 py-2 text-center ring-1 ring-emerald-200">
							<p class="text-[11px] text-emerald-800">อยู่ในกะแล้ว</p>
							<p class="text-base font-bold text-emerald-700 tabular-nums">
								{activeAssignedCount} คน
							</p>
						</div>
						<div class="rounded-xl bg-muted px-3 py-2 text-center">
							<p class="text-[11px] text-muted-foreground">ยังขาดอีก</p>
							<p class="text-base font-bold text-foreground tabular-nums">{remaining} คน</p>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- 2 Columns Layout: Left = กะงาน, Right = จิตอาสา -->
		<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
			<!-- Col ซ้าย: เลือกเวลากะงาน (Multi-select โดยคลิกที่การ์ด กะเต็ม disabled) -->
			<aside class="min-w-0 space-y-3 lg:sticky lg:top-4 lg:col-span-5 xl:col-span-4">
				<div class="space-y-3 rounded-2xl border border-border bg-card p-3.5">
					<div class="flex items-center justify-between gap-2 border-b border-border pb-2.5">
						<h3 class="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
							<CalendarDays class="h-4 w-4 text-primary" />
							เวลากะงาน ({orderedShifts.length} กะ)
						</h3>
						{#if targetShifts.length > 0}
							<span
								class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
							>
								เลือก {targetShifts.length} กะ
							</span>
						{/if}
					</div>
					<p class="text-xs text-muted-foreground">
						คลิกที่กะเพื่อเลือกหลายกะพร้อมกัน (กะที่เต็มแล้วจะเลือกไม่ได้)
					</p>

					{#if orderedShifts.length === 0}
						<p class="py-6 text-center text-xs text-muted-foreground">งานนี้ยังไม่มีกะย่อย</p>
					{:else}
						<div class="space-y-2" data-testid="multi-shift">
							{#each orderedShifts as s (s.id)}
								{@const isSelected = selectedShiftIds.includes(s.id)}
								{@const assigned = assignedByShiftId.get(s.id) ?? 0}
								{@const shiftRem = Math.max(s.quota - assigned, 0)}
								{@const isFull = s.quota > 0 && shiftRem === 0}
								{@const total = s.quota > 0 ? s.quota : 1}
								<button
									type="button"
									disabled={isFull}
									onclick={() => toggleShift(s)}
									aria-label={`เลือกกะ ${shiftLabel(s)}`}
									aria-pressed={isSelected}
									class="w-full rounded-xl border p-3 text-left transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none {isFull
										? 'cursor-not-allowed border-dashed border-border bg-muted/40 opacity-60'
										: isSelected
											? 'cursor-pointer border-primary bg-primary/5 shadow-2xs ring-1 ring-primary'
											: 'cursor-pointer border-border bg-background hover:border-border/80 hover:bg-muted/20'}"
								>
									<div class="flex items-start justify-between gap-2">
										<div class="flex items-start gap-2.5">
											<div
												class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors {isFull
													? 'border-muted-foreground/30 bg-muted'
													: isSelected
														? 'border-primary bg-primary text-primary-foreground'
														: 'border-muted-foreground/40 bg-background'}"
											>
												{#if isSelected}
													<Check class="h-3 w-3 stroke-[3]" />
												{/if}
											</div>
											<div>
												<div class="flex flex-wrap items-center gap-1.5">
													<span class="text-sm font-bold text-foreground">
														{s.date}
													</span>
													{#if s.end_date !== s.date}
														<span class="text-xs text-muted-foreground">(ถึง {s.end_date})</span>
													{/if}
												</div>
												<p class="mt-0.5 text-xs font-medium text-muted-foreground">
													{s.start_time} - {s.end_time} น.
												</p>
											</div>
										</div>

										<div class="shrink-0">
											{#if isFull}
												<span
													class="rounded-full bg-destructive/15 px-2 py-0.5 text-2xs font-semibold text-destructive"
												>
													กะเต็มแล้ว
												</span>
											{:else if isSelected && s.id === activeShiftId && targetShifts.length > 1}
												<span
													class="rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-semibold text-primary"
												>
													กะหลัก
												</span>
											{:else if isSelected}
												<span
													class="rounded-full bg-emerald-100 px-2 py-0.5 text-2xs font-semibold text-emerald-800"
												>
													เลือกแล้ว
												</span>
											{/if}
										</div>
									</div>

									<div class="mt-2.5 space-y-1 border-t border-border/60 pt-2 text-xs">
										<div class="flex items-center justify-between text-muted-foreground">
											<span>โควตา {assigned}/{s.quota} คน</span>
											<span
												class={isFull
													? 'font-semibold text-destructive'
													: 'font-semibold text-emerald-700'}
											>
												{isFull ? 'กะเต็มแล้ว (ปิดรับ)' : `ยังขาด ${shiftRem} คน`}
											</span>
										</div>
										<div class="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
											<div
												class="h-full {isFull ? 'bg-destructive' : 'bg-emerald-500'} transition-all"
												style:width="{(Math.min(assigned, s.quota) / total) * 100}%"
											></div>
										</div>
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</aside>

			<!-- Col ขวา: จิตอาสา -->
			<main class="min-w-0 space-y-4 lg:col-span-7 xl:col-span-8">
				<!-- Search + the three filter groups -->
				<div class="space-y-3 rounded-2xl border border-border bg-card p-3.5">
					<div class="relative">
						<Search
							class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							bind:value={search}
							class="!h-11 pl-9"
							placeholder="ค้นหาชื่อ-นามสกุล, ชื่อเล่น, เบอร์โทรศัพท์, รหัสประจำตัวจิตอาสา..."
							aria-label="ค้นหาอาสาสมัคร"
						/>
					</div>

					<div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
						<div class="min-w-0 space-y-1.5 md:col-span-2 xl:col-span-1">
							<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
								<Target class="h-3.5 w-3.5 shrink-0" />
								ตัวกรองความตรงของทักษะ:
							</p>
							<div class="flex w-full min-w-0 flex-wrap gap-1 rounded-xl bg-muted p-1">
								<Button
									variant={skillFilter === 'all' ? 'default' : 'ghost'}
									class={SEGMENT_BASE}
									onclick={() => (skillFilter = 'all')}
								>
									ทั้งหมด ({roster.rows.length})
								</Button>
								<Button
									variant={skillFilter === 'match' ? 'default' : 'ghost'}
									class="{SEGMENT_BASE} inline-flex items-center justify-center gap-1.5"
									onclick={() => (skillFilter = 'match')}
								>
									<Target class="h-3.5 w-3.5 shrink-0" />
									<span class="break-words">
										{#if hasJobSkills}
											ตรงกับงานอาสาสมัครนี้ ({matchedCandidateCount})
										{:else}
											ตรงกับงานอาสาสมัครนี้
										{/if}
									</span>
								</Button>
							</div>
						</div>

						<div class="min-w-0 space-y-1.5">
							<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
								<Timer class="h-3.5 w-3.5 shrink-0" />
								ตัวกรองความพร้อมในกะ:
							</p>
							<div class="flex w-full min-w-0 flex-wrap gap-1 rounded-xl bg-muted p-1">
								<Button
									variant={availabilityFilter === 'all' ? 'default' : 'ghost'}
									class={SEGMENT_BASE}
									onclick={() => (availabilityFilter = 'all')}
								>
									ทั้งหมด
								</Button>
								<Button
									variant={availabilityFilter === 'ready' ? 'default' : 'ghost'}
									class="{SEGMENT_BASE} inline-flex items-center justify-center gap-1.5"
									onclick={() => (availabilityFilter = 'ready')}
								>
									<CircleCheck class="h-3.5 w-3.5 shrink-0" />
									<span class="break-words">พร้อมปฏิบัติงาน</span>
								</Button>
								<Button
									variant={availabilityFilter === 'no_collision' ? 'default' : 'ghost'}
									class="{SEGMENT_BASE} inline-flex items-center justify-center gap-1.5"
									onclick={() => (availabilityFilter = 'no_collision')}
								>
									<Timer class="h-3.5 w-3.5 shrink-0" />
									<span class="break-words">เวลาไม่ชนกะ</span>
								</Button>
							</div>
						</div>

						<div class="min-w-0 space-y-1.5">
							<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
								<ShieldCheck class="h-3.5 w-3.5 shrink-0" />
								ตัวกรองสิทธิ์/การยืนยันตัวตน:
							</p>
							<div class="flex w-full min-w-0 flex-wrap gap-1 rounded-xl bg-muted p-1">
								<Button
									variant={eligibilityFilter === 'all' ? 'default' : 'ghost'}
									class={SEGMENT_BASE}
									onclick={() => (eligibilityFilter = 'all')}
								>
									ทั้งหมด
								</Button>
								<Button
									variant={eligibilityFilter === 'verified' ? 'default' : 'ghost'}
									class={SEGMENT_BASE}
									onclick={() => (eligibilityFilter = 'verified')}
								>
									<span class="break-words">ยืนยันตัวตนแล้ว</span>
								</Button>
								<Button
									variant={eligibilityFilter === 'professional' ? 'default' : 'ghost'}
									class={SEGMENT_BASE}
									onclick={() => (eligibilityFilter = 'professional')}
								>
									<span class="break-words">ทักษะวิชาชีพ/เจ้าหน้าที่</span>
								</Button>
							</div>
						</div>
					</div>
				</div>

				<!-- Roster -->
				<div class="rounded-2xl border border-border bg-card p-3.5">
					<div
						class="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3"
					>
						<div class="flex min-w-0 items-center gap-2.5">
							<Checkbox
								id="assign-select-all"
								checked={allSelected}
								disabled={assignableCount === 0}
								onCheckedChange={(next) => toggleAll(next === true)}
							/>
							<Label
								for="assign-select-all"
								class="min-w-0 cursor-pointer text-sm font-bold break-words"
							>
								เลือกทั้งหมดที่ผ่านตัวกรอง ({assignableCount} คนที่สามารถมอบหมายได้)
							</Label>
						</div>
						<p class="text-xs text-muted-foreground">
							แสดงผล {visible.length} จากทั้งหมด {roster.rows.length} คน
						</p>
					</div>

					{#snippet rosterRows(rows: typeof visible)}
						<ul class="space-y-2">
							{#each rows as candidate (candidate.volunteer._id)}
								<AssignRosterRow
									{candidate}
									selected={selectedIds.includes(candidate.volunteer._id)}
									skillOptions={skillCatalog.options}
									{requiredSkills}
									{hasJobSkills}
									capacityAvailable={remaining > 0}
									onToggle={toggleOne}
									onDetails={openDetails}
									onAssign={assignOne}
								/>
							{/each}
						</ul>
					{/snippet}

					{#if roster.error}
						<p class="py-8 text-center text-sm text-destructive">{roster.error}</p>
					{:else if visible.length === 0}
						<p class="py-8 text-center text-sm text-muted-foreground">
							ไม่พบอาสาสมัครที่ตรงกับตัวกรอง
						</p>
					{:else}
						<div class="space-y-5 pt-3">
							{#if onShift.length > 0}
								<section>
									<div
										class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 ring-1 ring-emerald-200"
									>
										<h4 class="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
											<CircleCheck class="h-4 w-4 shrink-0" />
											อยู่ในกะนี้แล้ว
											<span
												class="rounded-full bg-white px-2 py-0.5 tabular-nums ring-1 ring-emerald-200"
											>
												{onShift.length} คน
											</span>
										</h4>
										<p class="text-[11px] text-emerald-800/80">
											มอบหมายซ้ำไม่ได้ — ถอดออกได้ที่แท็บ “กะและตารางกะ”
										</p>
									</div>
									{@render rosterRows(onShift)}
								</section>
							{/if}

							<section>
								<div
									class="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2"
								>
									<h4 class="inline-flex items-center gap-1.5 text-xs font-bold text-foreground">
										<UserRoundPlus class="h-4 w-4 shrink-0 text-primary" />
										ยังไม่ได้มอบหมายในกะนี้
										<span class="rounded-full bg-card px-2 py-0.5 tabular-nums ring-1 ring-border">
											{unassigned.length} คน
										</span>
									</h4>
									<p class="text-[11px] text-muted-foreground">
										มอบหมายได้ {assignableCount} คน · เวลาชนกะอื่น {unassigned.length -
											assignableCount} คน
									</p>
								</div>
								{#if unassigned.length === 0}
									<p class="py-6 text-center text-sm text-muted-foreground">
										อาสาที่ผ่านตัวกรองทั้งหมดอยู่ในกะนี้แล้ว
									</p>
								{:else}
									{@render rosterRows(paginatedUnassigned)}
									{#if totalPages > 1}
										<div
											class="mt-4 flex flex-col items-center justify-between gap-3 border-t border-border pt-3 sm:flex-row"
										>
											<p class="text-xs text-muted-foreground">
												แสดงหน้าที่ {safePage} จาก {totalPages} ({paginatedUnassigned.length} จาก {unassignedTotal}
												คน)
											</p>
											<PaginationControls
												bind:page={currentPage}
												count={unassignedTotal}
												perPage={PAGE_SIZE}
											/>
										</div>
									{/if}
								{/if}
							</section>
						</div>
					{/if}
				</div>
			</main>
		</div>

		<!-- Sticky action bar: the roster can be long, the action must stay reachable. -->
		<div
			class="sticky bottom-0 flex flex-col gap-2 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-3"
		>
			<p class="text-xs text-muted-foreground">
				เลือกไว้ <span class="font-bold text-foreground tabular-nums">{selectedCount}</span> คน ·
				กะนี้รับได้อีก
				<span class="font-bold text-foreground tabular-nums">{remaining}</span> คน
				{#if overCapacity}
					<span class="ml-1 font-medium text-destructive">— เลือกเกินโควตาที่เหลือ</span>
				{/if}
			</p>
			<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
				<Button type="button" variant="ghost" class="min-h-11" onclick={backToDetail}>ยกเลิก</Button
				>
				<Button
					type="button"
					class="h-auto min-h-11 w-full gap-1.5 py-2 whitespace-normal sm:w-auto sm:min-w-[220px]"
					aria-label={sending
						? undefined
						: multiShift
							? `มอบหมายอาสา ${selectedCount} คนเข้า ${targetShifts.length} กะ`
							: `มอบหมายอาสา ${selectedCount} คนเข้ากะนี้`}
					disabled={selectedCount === 0 || targetShifts.length === 0 || overCapacity || sending}
					onclick={assignSelected}
				>
					{#if sending}
						{#if bulkProgress}
							กำลังมอบหมาย ({bulkProgress.current}/{bulkProgress.total})...
						{:else}
							กำลังมอบหมาย...
						{/if}
					{:else}
						<Send class="size-4 shrink-0" />
						<!-- A short label on the narrowest phones, where the full one breaks mid-word. -->
						<span class="min-[400px]:hidden">มอบหมาย {selectedCount} คน</span>
						<span class="hidden min-[400px]:inline">
							{multiShift
								? `มอบหมายอาสา ${selectedCount} คนเข้า ${targetShifts.length} กะ`
								: `มอบหมายอาสา ${selectedCount} คนเข้ากะนี้`}
						</span>
					{/if}
				</Button>
			</div>
		</div>
	{/if}
</div>

<Dialog.Root bind:open={bulkResultOpen}>
	<Dialog.Content
		class="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-xl"
		data-testid="bulk-result"
	>
		<div class="space-y-1 border-b border-border px-5 py-4 pr-12">
			<Dialog.Title class="text-base font-bold">ผลการมอบหมาย</Dialog.Title>
			<Dialog.Description class="text-sm">
				{#if bulkResult}
					มอบหมายสำเร็จ <span class="font-bold text-emerald-700">{bulkResult.placedCount}</span>
					รายการ ·
					<span class="font-bold text-amber-700">ไม่ได้มอบหมาย {bulkResult.notPlacedCount}</span> รายการ
				{/if}
			</Dialog.Description>
		</div>
		<div class="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
			{#if bulkResult}
				{#each bulkResult.people as person (person.volunteerId)}
					<section class="space-y-1.5 rounded-xl border border-border p-3">
						<p class="font-bold text-foreground">{person.name}</p>
						{#if person.placed.length > 0}
							<div class="text-sm">
								<p class="font-semibold text-emerald-700">เข้ากะแล้ว</p>
								<ul class="list-disc pl-5 text-foreground">
									{#each person.placed as item (item.shiftId)}
										<li>{item.shift}</li>
									{/each}
								</ul>
							</div>
						{/if}
						{#if person.notPlaced.length > 0}
							<div class="text-sm">
								<p class="font-semibold text-amber-700">ไม่ได้เข้ากะ</p>
								<ul class="list-disc pl-5 text-foreground">
									{#each person.notPlaced as item (item.shiftId)}
										<li>
											<span class="font-medium">กะ {item.shift}</span>
											<span class="block text-muted-foreground">{item.why}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</section>
				{/each}
			{/if}
		</div>
		<div class="flex justify-end border-t border-border px-5 py-3">
			<Button type="button" onclick={() => (bulkResultOpen = false)}>รับทราบ</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<AssignVolunteerDetailDialog
	bind:open={detailOpen}
	candidate={detailCandidate}
	shelterLabel={detailCandidate ? candidateShelterLabel(detailCandidate) : shelterLabel}
	skillOptions={skillCatalog.options}
	pending={sending}
	onassign={assignOne}
/>

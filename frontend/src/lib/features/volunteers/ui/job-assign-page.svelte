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
	 *   - the 4-way quota breakdown    → `domain/capacity.ts#jobShiftQuotaSplits`
	 *   - the UTC duty window written  → `domain/duty-window.ts#shiftDutyWindow`
	 * Nothing here recomputes eligibility, collisions or capacity inline.
	 *
	 * There is NO offer/accept step (owner decision 2026-08-29): the SM assigns
	 * outright. `useAssignVolunteers` → `ShiftAssignmentRepository#assign`
	 * creates the assignment already accepted AND moves
	 * `job.slots_remaining → slots_confirmed` in the same call, retrying on
	 * CouchDB 409. The calls are sequential on purpose — they all
	 * read-modify-write the same job document, so firing them in parallel would
	 * just make every one of them conflict and retry.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Search from '@lucide/svelte/icons/search';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Users from '@lucide/svelte/icons/users';
	import Target from '@lucide/svelte/icons/target';
	import Timer from '@lucide/svelte/icons/timer';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import UserRoundPlus from '@lucide/svelte/icons/user-round-plus';
	import Send from '@lucide/svelte/icons/send';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { useShelter } from '$lib/features/shelters';
	import AssignRosterRow from './assign-roster-row.svelte';
	import { jobShiftQuotaSplits } from '../domain/capacity';
	import { shiftDutyWindow } from '../domain/duty-window';
	import type { JobShift } from '../domain/job.schema';
	import {
		buildAssignRoster,
		countAssignable,
		filterAssignRoster,
		shiftKindFor,
		type AvailabilityFilter,
		type EligibilityFilter,
		type SkillFilter
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
	 * Chronological, matching `job-shifts-tab.svelte` — `jobShiftQuotaSplits`
	 * allocates seats by position, so it must be handed the same order the
	 * detail screen shows.
	 */
	const orderedShifts = $derived(
		[...(job?.shifts ?? [])].sort((a, b) =>
			`${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`)
		)
	);
	const splits = $derived(job ? jobShiftQuotaSplits({ ...job, shifts: orderedShifts }) : []);

	/** Empty until the SM picks one — the `?shift=` deep link, else the first shift, wins. */
	let pickedShiftId = $state('');
	const activeShiftId = $derived(
		pickedShiftId || shiftId || (orderedShifts.length > 0 ? orderedShifts[0].id : '')
	);
	const activeIndex = $derived(orderedShifts.findIndex((s) => s.id === activeShiftId));
	const shift = $derived(activeIndex >= 0 ? orderedShifts[activeIndex] : null);
	const split = $derived(activeIndex >= 0 ? splits[activeIndex] : null);

	function shiftLabel(s: JobShift, index: number): string {
		const q = splits[index];
		const crossesMidnight = s.end_date !== s.date;
		return (
			`${s.date} | ${s.start_time} - ${s.end_time} น.${crossesMidnight ? ` (ถึง ${s.end_date})` : ''}` +
			` (ต้องการ ${q?.target ?? 0} คน | ได้แล้ว ${q?.confirmed ?? 0} คน)`
		);
	}

	// — filters & selection ————————————————————————————————————————————————
	let search = $state('');
	let skillFilter = $state<SkillFilter>('all');
	let availabilityFilter = $state<AvailabilityFilter>('all');
	let eligibilityFilter = $state<EligibilityFilter>('all');
	let selectedIds = $state<string[]>([]);

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
			if (!shift) return { rows: [], error: 'งานนี้ยังไม่มีกะย่อย' };
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

	const remaining = $derived(split?.remaining ?? 0);
	const overCapacity = $derived(selectedCount > remaining);
	const sending = $derived(assignMutation.isPending);

	function pickShift(id: string) {
		pickedShiftId = id;
		// Row states are shift-specific — a carried-over selection could dispatch
		// someone who is not free in the newly picked shift.
		selectedIds = [];
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

	async function assignSelected() {
		if (!job || !shift || sending) return;
		const chosen = visible.filter((c) => c.assignable && selectedIds.includes(c.volunteer._id));
		if (chosen.length === 0) return;
		if (chosen.length > remaining) {
			toast.error(`กะนี้เหลือรับได้อีก ${remaining} คน แต่เลือกไว้ ${chosen.length} คน`);
			return;
		}

		let dutyWindow: ReturnType<typeof shiftDutyWindow>;
		try {
			dutyWindow = shiftDutyWindow(shift);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'กะนี้มีวันหรือเวลาไม่ถูกต้อง');
			return;
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
			} catch (err) {
				failed.push(`${candidate.volunteer.first_name} ${candidate.volunteer.last_name}`);
				// Quota is finite: once one dispatch fails there may be no seat
				// left, so stop rather than hammering the same document.
				if (err instanceof Error && err.message.includes('quota')) break;
			}
		}

		selectedIds = [];
		if (sent > 0) toast.success(`มอบหมายอาสา ${sent} คนเข้ากะนี้แล้ว`);
		if (failed.length > 0)
			toast.error(`มอบหมายไม่สำเร็จ ${failed.length} คน: ${failed.join(', ')}`);
	}

	// `flex-1` at every breakpoint (not just mobile) so each segmented row
	// stretches to fill its grid column instead of shrinking to content width
	// and leaving dead space beside it (owner feedback 2026-08-31).
	const SEGMENT_BASE = 'h-9 flex-1 rounded-lg px-2 text-xs font-medium transition-colors sm:px-3';
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button variant="outline" class="gap-1.5 rounded-xl text-xs sm:text-sm" onclick={backToDetail}>
			<ArrowLeft class="h-4 w-4" />
			ย้อนกลับไปหน้ารายละเอียดภารกิจ
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
			ไม่พบภารกิจนี้ (อาจถูกลบไปแล้ว)
		</p>
	{:else}
		<!-- Shift picker + multi-state quota breakdown -->
		<div class="rounded-2xl bg-primary-dark px-4 py-4 text-white sm:px-5">
			<p class="text-sm font-bold break-words">{job.title}</p>
			<p class="mt-0.5 text-xs text-white/60">ศูนย์: {shelterLabel}</p>

			<div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
				<div class="space-y-2">
					<Label for="assign-shift" class="inline-flex items-center gap-1.5 text-xs text-white/70">
						<CalendarDays class="h-3.5 w-3.5" />
						เลือกกะที่ต้องการจ่ายงาน/มอบหมาย:
					</Label>
					<Select.Root type="single" value={activeShiftId} onValueChange={pickShift}>
						<Select.Trigger
							id="assign-shift"
							class="!h-11 w-full border-white/20 bg-white/10 text-left text-sm font-bold text-white"
						>
							{#if shift && activeIndex >= 0}
								{shiftLabel(shift, activeIndex)}
							{:else}
								ยังไม่มีกะย่อยในงานนี้
							{/if}
						</Select.Trigger>
						<Select.Content>
							{#each orderedShifts as s, index (s.id)}
								<Select.Item value={s.id} label={shiftLabel(s, index)} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-2">
					<p class="inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
						<Users class="h-3.5 w-3.5" />
						สถานะโควตากำลังพลในกะนี้ (Multi-State Quota Breakdown):
					</p>
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
						<div class="rounded-xl bg-white/8 px-3 py-2 ring-1 ring-white/10">
							<p class="text-[11px] text-white/60">เป้าหมายทั้งหมด</p>
							<p class="text-lg font-bold tabular-nums">{split?.target ?? 0} คน</p>
						</div>
						<div class="rounded-xl bg-emerald-500/15 px-3 py-2 ring-1 ring-emerald-400/30">
							<p class="text-[11px] text-emerald-200">🟢 ตอบรับ/ยืนยัน</p>
							<p class="text-lg font-bold text-emerald-300 tabular-nums">
								{split?.confirmed ?? 0} คน
							</p>
						</div>
						<div class="rounded-xl bg-amber-400/15 px-3 py-2 ring-1 ring-amber-300/30">
							<p class="text-[11px] text-amber-200">🟡 เสนอมอบหมาย</p>
							<p class="text-lg font-bold text-amber-300 tabular-nums">
								{split?.dispatched ?? 0} คน
							</p>
						</div>
						<div class="rounded-xl bg-white/8 px-3 py-2 ring-1 ring-white/10">
							<p class="text-[11px] text-white/60">⚪ ยังขาดอีก</p>
							<p class="text-lg font-bold tabular-nums">{remaining} คน</p>
						</div>
					</div>
					{#if split}
						{@const total = split.target > 0 ? split.target : 1}
						<div class="flex h-2 w-full overflow-hidden rounded-full bg-white/15">
							<div
								class="h-full bg-emerald-500"
								style:width="{(split.confirmed / total) * 100}%"
							></div>
							<div
								class="h-full bg-amber-400"
								style:width="{(split.dispatched / total) * 100}%"
							></div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Search + the three filter groups -->
		<div class="space-y-3 rounded-2xl border border-border bg-card p-3.5">
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={search}
					class="!h-11 pl-9"
					placeholder="ค้นหาชื่อ-นามสกุล, เบอร์โทรศัพท์, รหัสประจำตัวจิตอาสา..."
					aria-label="ค้นหาอาสาสมัคร"
				/>
			</div>

			<div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
				<div class="space-y-1.5">
					<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
						<Target class="h-3.5 w-3.5" />
						ตัวกรองความตรงของทักษะ:
					</p>
					<div class="flex gap-1 rounded-xl bg-muted p-1">
						<Button
							variant={skillFilter === 'all' ? 'default' : 'ghost'}
							class={SEGMENT_BASE}
							onclick={() => (skillFilter = 'all')}
						>
							ทั้งหมด
						</Button>
						<Button
							variant={skillFilter === 'match' ? 'default' : 'ghost'}
							class={SEGMENT_BASE}
							onclick={() => (skillFilter = 'match')}
						>
							🎯 ตรงกับภารกิจนี้
						</Button>
					</div>
				</div>

				<div class="space-y-1.5">
					<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
						<Timer class="h-3.5 w-3.5" />
						ตัวกรองความพร้อมในกะ:
					</p>
					<div class="flex gap-1 rounded-xl bg-muted p-1">
						<Button
							variant={availabilityFilter === 'all' ? 'default' : 'ghost'}
							class={SEGMENT_BASE}
							onclick={() => (availabilityFilter = 'all')}
						>
							ทั้งหมด
						</Button>
						<Button
							variant={availabilityFilter === 'ready' ? 'default' : 'ghost'}
							class={SEGMENT_BASE}
							onclick={() => (availabilityFilter = 'ready')}
						>
							🟢 พร้อมปฏิบัติงาน
						</Button>
						<Button
							variant={availabilityFilter === 'no_collision' ? 'default' : 'ghost'}
							class={SEGMENT_BASE}
							onclick={() => (availabilityFilter = 'no_collision')}
						>
							⏱ เวลาไม่ชนกะ
						</Button>
					</div>
				</div>

				<div class="space-y-1.5">
					<p class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
						<ShieldCheck class="h-3.5 w-3.5" />
						ตัวกรองสิทธิ์/การยืนยันตัวตน:
					</p>
					<div class="flex gap-1 rounded-xl bg-muted p-1">
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
							ยืนยันตัวตนแล้ว
						</Button>
						<Button
							variant={eligibilityFilter === 'professional' ? 'default' : 'ghost'}
							class={SEGMENT_BASE}
							onclick={() => (eligibilityFilter = 'professional')}
						>
							ทักษะวิชาชีพ/เจ้าหน้าที่
						</Button>
					</div>
				</div>
			</div>
		</div>

		<!-- Roster -->
		<div class="rounded-2xl border border-border bg-card p-3.5">
			<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
				<div class="flex items-center gap-2.5">
					<Checkbox
						id="assign-select-all"
						checked={allSelected}
						disabled={assignableCount === 0}
						onCheckedChange={(next) => toggleAll(next === true)}
					/>
					<Label for="assign-select-all" class="cursor-pointer text-sm font-bold">
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
							shelterLabel={candidate.volunteer.current_shelter_code &&
							candidate.volunteer.current_shelter_code !== job.shelter_code
								? candidate.volunteer.current_shelter_code
								: shelterLabel}
							selected={selectedIds.includes(candidate.volunteer._id)}
							skillOptions={skillCatalog.options}
							onToggle={toggleOne}
						/>
					{/each}
				</ul>
			{/snippet}

			{#if roster.error}
				<p class="py-8 text-center text-sm text-destructive">{roster.error}</p>
			{:else if visible.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">ไม่พบอาสาสมัครที่ตรงกับตัวกรอง</p>
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
								มอบหมายได้ {assignableCount} คน · เวลาชนกะอื่น {unassigned.length - assignableCount} คน
							</p>
						</div>
						{#if unassigned.length === 0}
							<p class="py-6 text-center text-sm text-muted-foreground">
								อาสาที่ผ่านตัวกรองทั้งหมดอยู่ในกะนี้แล้ว
							</p>
						{:else}
							{@render rosterRows(unassigned)}
						{/if}
					</section>
				</div>
			{/if}
		</div>

		<!-- Sticky action bar: the roster can be long, the action must stay reachable. -->
		<div
			class="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur"
		>
			<p class="text-xs text-muted-foreground">
				เลือกไว้ <span class="font-bold text-foreground tabular-nums">{selectedCount}</span> คน ·
				กะนี้รับได้อีก
				<span class="font-bold text-foreground tabular-nums">{remaining}</span> คน
				{#if overCapacity}
					<span class="ml-1 font-medium text-destructive">— เลือกเกินโควตาที่เหลือ</span>
				{/if}
			</p>
			<div class="flex items-center gap-2">
				<Button type="button" variant="ghost" onclick={backToDetail}>ยกเลิก</Button>
				<Button
					type="button"
					class="!h-11 min-w-[220px] gap-1.5"
					disabled={selectedCount === 0 || overCapacity || sending}
					onclick={assignSelected}
				>
					{#if sending}
						กำลังมอบหมาย...
					{:else}
						<Send class="size-4" />
						มอบหมายอาสา {selectedCount} คนเข้ากะนี้
					{/if}
				</Button>
			</div>
		</div>
	{/if}
</div>

<script lang="ts">
	/**
	 * Job detail — Tab 2 "กะและตารางกะ (Shifts & Schedule)" (01-tab-job-board.md
	 * §01.5 "ตารางกะของงานนี้", approved mockup 2026-08-27).
	 *
	 * Adds/removes sub-shifts on an existing job. All date maths is the pure,
	 * unit-tested `domain/shift-batch.ts` (`generateBatchShifts`,
	 * `appendShifts`, `defaultShiftEndDate`) — the same functions the create
	 * form uses, so the two screens can never drift.
	 *
	 * Every change is persisted immediately through `useUpdateJob`: the job's
	 * `quota` is the sub-shift headcount sum (`totalShiftQuota`), and
	 * `JobRepository#update` then re-reads the latest revision to recompute
	 * `slots_remaining` and re-derive `status`, rejecting a quota that has
	 * fallen below what volunteers already hold. Dispatch itself needs the
	 * volunteer roster screen, so those buttons stay disabled here.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import Layers from '@lucide/svelte/icons/layers';
	import Plus from '@lucide/svelte/icons/plus';
	import Zap from '@lucide/svelte/icons/zap';
	import CalendarRange from '@lucide/svelte/icons/calendar-range';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import { ulid } from '$lib/db/ulid';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import JobShiftCard from './job-shift-card.svelte';
	import JobShiftEditDialog from './job-shift-edit-dialog.svelte';
	import JobShiftRosterDialog from './job-shift-roster-dialog.svelte';
	import { jobShiftQuotaSplits } from '../domain/capacity';
	import { shiftRoster, type ShiftRosterEntry } from '../domain/shift-roster';
	import { totalShiftQuota, type Job, type JobShift } from '../domain/job.schema';
	import {
		ALL_WEEKDAYS,
		WEEKDAYS,
		WEEKDAYS_MON_FRI,
		WEEKENDS,
		appendShifts,
		defaultShiftEndDate,
		generateBatchShifts,
		isDuplicateShift,
		type Weekday
	} from '../domain/shift-batch';
	import {
		useShiftAssignments,
		useUnassignVolunteer,
		useUpdateJob,
		useVolunteers
	} from '../application/queries';

	let { job }: { job: Job } = $props();

	const queryClient = useQueryClient();
	const updateMutation = useUpdateJob(queryClient);
	const unassignMutation = useUnassignVolunteer(queryClient);
	const saving = $derived(updateMutation.isPending);

	const assignmentsQuery = useShiftAssignments();
	const volunteersQuery = useVolunteers();
	const volunteersById = $derived(new Map((volunteersQuery.data ?? []).map((v) => [v._id, v])));

	let mode = $state<'single' | 'batch'>('single');

	/**
	 * Assigning volunteers lives on its own page. `resolve()` in this SvelteKit version only
	 * prefixes `base`, so the `[id]` segment is built here — `job._id` contains
	 * a colon, hence the encode (same as `job-card.svelte`).
	 */
	function openAssign(shiftId?: string) {
		const query = shiftId ? `?shift=${encodeURIComponent(shiftId)}` : '';
		goto(resolve(`/back-office/volunteers/jobs/${encodeURIComponent(job._id)}/assign${query}`));
	}

	let singleDate = $state('');
	let singleStart = $state('08:00');
	let singleEnd = $state('16:00');
	let singleSeats = $state(5);

	let batchStart = $state('');
	let batchEnd = $state('');
	let batchStartTime = $state('08:00');
	let batchEndTime = $state('16:00');
	let batchSeats = $state(5);
	let batchWeekdays = $state<Weekday[]>([...ALL_WEEKDAYS]);

	/** Prefilled, editable-by-time: a shift crossing midnight ends on the next day. */
	const singleEndDate = $derived(
		singleDate ? defaultShiftEndDate(singleDate, singleStart, singleEnd) : ''
	);

	/**
	 * Sorted first, split second: `shifts[]` is stored in insertion order, and
	 * `jobShiftQuotaSplits` allocates seats "earliest shift first" by position —
	 * so it has to be handed the chronological order, or a shift added later for
	 * an earlier date would be shown as unfilled while a later one holds seats.
	 */
	const orderedShifts = $derived(
		[...job.shifts].sort((a, b) =>
			`${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`)
		)
	);
	const splits = $derived(jobShiftQuotaSplits({ ...job, shifts: orderedShifts }));
	const rows = $derived(
		orderedShifts.map((shift, index) => ({
			shift,
			split: splits[index],
			roster: shiftRoster(shift, job._id, assignmentsQuery.data ?? [], volunteersById)
		}))
	);

	let unassignTarget = $state<ShiftRosterEntry | null>(null);

	async function confirmUnassign() {
		const target = unassignTarget;
		unassignTarget = null;
		if (!target) return;
		try {
			await unassignMutation.mutateAsync(target.assignmentId);
			toast.success(`ลบ ${target.volunteerName} ออกจากกะแล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ลบออกจากกะไม่สำเร็จ');
		}
	}

	const canAddSingle = $derived(
		singleDate !== '' &&
			singleStart !== '' &&
			singleEnd !== '' &&
			Number.isInteger(singleSeats) &&
			singleSeats > 0
	);
	const canGenerateBatch = $derived(
		batchStart !== '' &&
			batchEnd !== '' &&
			batchWeekdays.length > 0 &&
			Number.isInteger(batchSeats) &&
			batchSeats > 0
	);

	/** One place that writes `shifts` — `quota` is always re-derived from the rows. */
	async function persistShifts(shifts: JobShift[], successMessage: string) {
		try {
			await updateMutation.mutateAsync({ ...job, shifts, quota: totalShiftQuota(shifts) });
			toast.success(successMessage);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกกะไม่สำเร็จ');
		}
	}

	async function mergeAndPersist(incoming: JobShift[]) {
		const { shifts, added, skipped } = appendShifts(job.shifts, incoming);
		if (added === 0) {
			toast.info('กะที่สร้างซ้ำกับรายการเดิมทั้งหมด');
			return;
		}
		await persistShifts(
			shifts,
			skipped > 0 ? `เพิ่ม ${added} กะ (ข้ามที่ซ้ำ ${skipped} กะ)` : `เพิ่ม ${added} กะแล้ว`
		);
	}

	async function addSingleShift() {
		if (!canAddSingle || saving) return;
		const row: JobShift = {
			id: `js-${ulid()}`,
			date: singleDate,
			end_date: singleEndDate,
			start_time: singleStart,
			end_time: singleEnd,
			quota: singleSeats
		};
		if (`${row.end_date}T${row.end_time}` <= `${row.date}T${row.start_time}`) {
			toast.error('เวลาสิ้นสุดกะต้องอยู่หลังเวลาเริ่มกะ');
			return;
		}
		if (isDuplicateShift(row, job.shifts)) {
			toast.info('มีกะวันและเวลานี้อยู่แล้ว');
			return;
		}
		await mergeAndPersist([row]);
		singleDate = '';
	}

	async function generateBatch() {
		if (!canGenerateBatch || saving) return;
		try {
			const rowsToAdd = generateBatchShifts(
				{
					startDate: batchStart,
					endDate: batchEnd,
					weekdays: batchWeekdays,
					start_time: batchStartTime,
					end_time: batchEndTime,
					quota: batchSeats
				},
				() => `js-${ulid()}`
			);
			await mergeAndPersist(rowsToAdd);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'สร้างกะเป็นช่วงวันไม่สำเร็จ');
		}
	}

	async function removeShift(shiftId: string) {
		if (saving) return;
		const shifts = job.shifts.filter((s) => s.id !== shiftId);
		if (shifts.length === 0) {
			toast.error('งานต้องมีกะย่อยอย่างน้อย 1 กะ');
			return;
		}
		await persistShifts(shifts, 'ลบกะออกจากงานแล้ว');
	}

	let editOpen = $state(false);
	let editShiftId = $state<string | null>(null);
	let removeShiftId = $state<string | null>(null);
	let rosterOpen = $state(false);
	let rosterShiftId = $state<string | null>(null);
	const rosterRow = $derived(rows.find((r) => r.shift.id === rosterShiftId) ?? null);

	function openRoster(shiftId: string) {
		rosterShiftId = shiftId;
		rosterOpen = true;
	}

	const editRow = $derived(rows.find((r) => r.shift.id === editShiftId) ?? null);
	/** Every OTHER shift — the edit dialog's duplicate check must not match the row itself. */
	const editSiblings = $derived(job.shifts.filter((s) => s.id !== editShiftId));
	/** Seats this shift already holds; the edit dialog refuses to cut below it. */
	const editMinQuota = $derived(editRow ? editRow.split.confirmed + editRow.split.dispatched : 0);

	const removeRow = $derived(rows.find((r) => r.shift.id === removeShiftId) ?? null);
	/**
	 * Deleting a shift cascades: every volunteer still `assigned`/`standby` on
	 * it is automatically unassigned first (owner feedback 2026-08-31 —
	 * previously the SM had to release each one by hand before the quota cut
	 * would be accepted). `checked_in`/`completed` rows are never cascaded —
	 * `unassign()` refuses them on purpose, to protect attendance history — so
	 * a shift someone already worked still blocks deletion.
	 */
	const removeCascade = $derived(
		(removeRow?.roster ?? []).filter((e) => e.status === 'assigned' || e.status === 'standby')
	);
	const removeBlocking = $derived(
		(removeRow?.roster ?? []).filter((e) => e.status === 'checked_in' || e.status === 'completed')
	);

	/**
	 * Cascading THIS shift's own roster is not always enough: `job.quota` /
	 * `slots_confirmed` / `slots_dispatched` are JOB-LEVEL totals, so a job
	 * with two shifts (5 + 7 seats, say) can have all 7 confirmed volunteers
	 * sitting on the shift that ISN'T being deleted — removing the other one
	 * still shrinks `job.quota` below what those 7 already hold, and
	 * `JobRepository#update` throws a `QuotaError` no matter how clean this
	 * shift's own roster is (owner-reported case 2026-08-31).
	 *
	 * Precompute that overflow up front (rather than reacting to the error
	 * after the fact) so the confirm dialog can show exactly who else would be
	 * removed, from OTHER shifts of this job, before the SM commits — most
	 * recently assigned first, since that is the least operationally
	 * disruptive volunteer to bump. `checked_in`/`completed` rows are never
	 * candidates (same rule as `removeBlocking`), so if there aren't enough
	 * releasable rows to close the gap, deletion stays blocked rather than
	 * guessing.
	 */
	const removeOverflow = $derived.by(() => {
		if (!removeRow) return { needed: 0, candidates: [] as ShiftRosterEntry[] };
		const newQuota = job.quota - removeRow.shift.quota;
		const claimedAfterCascade = job.slots_confirmed + job.slots_dispatched - removeCascade.length;
		const needed = claimedAfterCascade - newQuota;
		if (needed <= 0) return { needed: 0, candidates: [] };

		const alreadyCascaded = new Set(removeCascade.map((e) => e.assignmentId));
		const candidates = (assignmentsQuery.data ?? [])
			.filter(
				(a) =>
					a.job_id === job._id &&
					!alreadyCascaded.has(a._id) &&
					(a.status === 'assigned' || a.status === 'standby')
			)
			.sort((a, b) => b.created_at.localeCompare(a.created_at))
			.slice(0, needed)
			.map((a): ShiftRosterEntry => {
				const volunteer = volunteersById.get(a.volunteer_id);
				return {
					assignmentId: a._id,
					volunteerId: a.volunteer_id,
					volunteerName: volunteer
						? `${volunteer.first_name} ${volunteer.last_name}`
						: 'ไม่พบข้อมูลอาสาสมัคร',
					volunteerCode: volunteer?.volunteer_code ?? '—',
					status: a.status,
					dispatchStatus: a.dispatch_status ?? null
				};
			});
		return { needed, candidates };
	});
	/** Not enough releasable (non-worked) seats elsewhere to close the gap. */
	const removeOverflowBlocked = $derived(removeOverflow.candidates.length < removeOverflow.needed);

	function openEdit(shiftId: string) {
		editShiftId = shiftId;
		editOpen = true;
	}

	/**
	 * Replace one row in place. Position matters: `jobShiftQuotaSplits`
	 * allocates seats "earliest shift first" by array position, so an edit must
	 * not reorder `shifts[]` — `persistShifts` re-derives `job.quota` from the
	 * result either way.
	 */
	async function saveEdit(updated: JobShift) {
		if (saving) return;
		editOpen = false;
		await persistShifts(
			job.shifts.map((s) => (s.id === updated.id ? updated : s)),
			'แก้ไขกะเรียบร้อยแล้ว'
		);
	}

	async function confirmRemove() {
		const id = removeShiftId;
		if (removeOverflowBlocked) {
			removeShiftId = null;
			return;
		}
		const toRelease = [...removeCascade, ...removeOverflow.candidates];
		removeShiftId = null;
		if (!id) return;

		// Sequential, not `Promise.all`: every unassign is a read-modify-write on
		// the SAME job document (`JobRepository#releaseSlot`), so firing them in
		// parallel would just make each one conflict-retry against the others.
		for (const entry of toRelease) {
			try {
				await unassignMutation.mutateAsync(entry.assignmentId);
			} catch (err) {
				toast.error(
					`ถอดอาสา ${entry.volunteerName} ออกจากกะไม่สำเร็จ: ${err instanceof Error ? err.message : 'เกิดข้อผิดพลาด'} — ยกเลิกการลบกะ`
				);
				return;
			}
		}
		await removeShift(id);
	}

	function toggleWeekday(day: Weekday) {
		batchWeekdays = batchWeekdays.includes(day)
			? batchWeekdays.filter((d) => d !== day)
			: [...batchWeekdays, day];
	}
</script>

<div class="space-y-4">
	<div class="rounded-2xl border border-border bg-card p-4 shadow-xs">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h3 class="inline-flex items-center gap-2 text-sm font-bold text-foreground">
					<Layers class="h-4 w-4 text-primary" />
					เครื่องมือเพิ่มกะย่อย (Shifts Generator)
				</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					เลือกโหมดเพื่อเพิ่มกะเดี่ยวเฉพาะวัน หรือสร้างแบบ Batch Generator ต่อเนื่องหลายสัปดาห์
				</p>
			</div>

			<div class="inline-flex gap-1 rounded-xl bg-muted p-1">
				<Button
					size="sm"
					variant={mode === 'single' ? 'default' : 'ghost'}
					class="gap-1.5 rounded-lg text-xs"
					onclick={() => (mode = 'single')}
				>
					<Plus class="h-3.5 w-3.5" />
					เพิ่มทีละวัน (Single)
				</Button>
				<Button
					size="sm"
					variant={mode === 'batch' ? 'default' : 'ghost'}
					class="gap-1.5 rounded-lg text-xs"
					onclick={() => (mode = 'batch')}
				>
					<Zap class="h-3.5 w-3.5" />
					สร้างเป็นช่วงวัน (Batch Generator)
				</Button>
			</div>
		</div>

		{#if mode === 'single'}
			<div
				class="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-border bg-background p-3.5 sm:grid-cols-2 xl:grid-cols-5"
			>
				<div class="space-y-1.5">
					<Label for="shift-date" class="text-xs"
						>วันที่ปฏิบัติงาน <span class="text-destructive">*</span></Label
					>
					<DatePicker id="shift-date" bind:value={singleDate} />
				</div>
				<div class="space-y-1.5">
					<Label for="shift-start" class="text-xs"
						>เวลาเข้ากะ <span class="text-destructive">*</span></Label
					>
					<TimePicker id="shift-start" bind:value={singleStart} />
				</div>
				<div class="space-y-1.5">
					<Label for="shift-end" class="text-xs"
						>เวลาออกกะ <span class="text-destructive">*</span></Label
					>
					<TimePicker id="shift-end" bind:value={singleEnd} />
				</div>
				<div class="space-y-1.5">
					<Label for="shift-seats" class="text-xs"
						>จำนวนคน (คน/กะ) <span class="text-destructive">*</span></Label
					>
					<Input
						id="shift-seats"
						type="number"
						min="1"
						step="1"
						class="!h-11"
						bind:value={singleSeats}
					/>
				</div>
				<div class="flex items-end">
					<Button
						class="h-11 w-full gap-1.5"
						disabled={!canAddSingle || saving}
						onclick={addSingleShift}
					>
						<Plus class="h-4 w-4" />
						เพิ่มกะนี้
					</Button>
				</div>
				{#if singleEndDate && singleEndDate !== singleDate}
					<p class="text-xs text-muted-foreground sm:col-span-2 xl:col-span-5">
						กะนี้ข้ามเที่ยงคืน — จะบันทึกวันสิ้นสุดเป็น {singleEndDate}
					</p>
				{/if}
			</div>
		{:else}
			<div class="mt-4 space-y-3 rounded-xl border border-border bg-background p-3.5">
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
					<div class="space-y-1.5">
						<Label for="batch-start" class="text-xs"
							>วันที่เริ่ม <span class="text-destructive">*</span></Label
						>
						<DatePicker id="batch-start" bind:value={batchStart} />
					</div>
					<div class="space-y-1.5">
						<Label for="batch-end" class="text-xs"
							>วันที่สิ้นสุด <span class="text-destructive">*</span></Label
						>
						<DatePicker id="batch-end" bind:value={batchEnd} />
					</div>
					<div class="space-y-1.5">
						<Label for="batch-start-time" class="text-xs"
							>เวลาเข้ากะ <span class="text-destructive">*</span></Label
						>
						<TimePicker id="batch-start-time" bind:value={batchStartTime} />
					</div>
					<div class="space-y-1.5">
						<Label for="batch-end-time" class="text-xs"
							>เวลาออกกะ <span class="text-destructive">*</span></Label
						>
						<TimePicker id="batch-end-time" bind:value={batchEndTime} />
					</div>
					<div class="space-y-1.5">
						<Label for="batch-seats" class="text-xs"
							>จำนวนคน (คน/กะ) <span class="text-destructive">*</span></Label
						>
						<Input
							id="batch-seats"
							type="number"
							min="1"
							step="1"
							class="!h-11"
							bind:value={batchSeats}
						/>
					</div>
				</div>

				<div class="flex flex-wrap items-center gap-1.5">
					<span class="mr-1 text-xs font-medium text-muted-foreground">วันในสัปดาห์:</span>
					{#each WEEKDAYS as day (day.value)}
						{@const active = batchWeekdays.includes(day.value)}
						<button
							type="button"
							onclick={() => toggleWeekday(day.value)}
							class={[
								'cursor-pointer rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors',
								active
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border bg-background text-muted-foreground hover:bg-muted'
							]}
						>
							{day.label}
						</button>
					{/each}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 text-[11px]"
						onclick={() => (batchWeekdays = [...WEEKDAYS_MON_FRI])}
					>
						จ.–ศ.
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="h-7 text-[11px]"
						onclick={() => (batchWeekdays = [...WEEKENDS])}
					>
						เสาร์–อาทิตย์
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="h-7 text-[11px]"
						onclick={() => (batchWeekdays = [...ALL_WEEKDAYS])}
					>
						ทุกวัน
					</Button>
				</div>

				<Button
					class="h-11 w-full gap-1.5 sm:w-auto"
					disabled={!canGenerateBatch || saving}
					onclick={generateBatch}
				>
					<CalendarRange class="h-4 w-4" />
					สร้างกะตามช่วงวัน
				</Button>
			</div>
		{/if}
	</div>

	<div class="rounded-2xl border border-border bg-card p-4 shadow-xs">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h3 class="inline-flex items-center gap-2 text-sm font-bold text-foreground">
				<CalendarRange class="h-4 w-4 text-primary" />
				รายการกะย่อยทั้งหมด ({job.shifts.length} กะ · รวม {job.quota} คน)
			</h3>
			<Button size="sm" class="gap-1.5" onclick={() => openAssign()}>
				<UserPlus class="h-3.5 w-3.5" />
				มอบหมายงานให้อาสา (Assign Volunteer)
			</Button>
		</div>

		<div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
			{#each rows as row (row.shift.id)}
				<JobShiftCard
					shift={row.shift}
					split={row.split}
					roster={row.roster}
					canRemove={job.shifts.length > 1}
					pending={saving}
					onedit={openEdit}
					onremove={(id) => (removeShiftId = id)}
					onassign={openAssign}
					onviewroster={openRoster}
				/>
			{/each}
		</div>
	</div>

	<JobShiftRosterDialog
		bind:open={rosterOpen}
		shift={rosterRow?.shift ?? null}
		roster={rosterRow?.roster ?? []}
		pending={saving || unassignMutation.isPending}
		onunassign={(entry) => (unassignTarget = entry)}
	/>

	<JobShiftEditDialog
		bind:open={editOpen}
		shift={editRow?.shift ?? null}
		siblings={editSiblings}
		minQuota={editMinQuota}
		pending={saving}
		onsave={saveEdit}
	/>

	<AlertDialog.Root
		open={removeShiftId !== null}
		onOpenChange={(next) => {
			if (!next) removeShiftId = null;
		}}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title class="flex items-center gap-2">
					<TriangleAlert class="h-4.5 w-4.5 text-destructive" />
					ลบกะนี้ออกจากงาน?
				</AlertDialog.Title>
				<AlertDialog.Description>
					{#if removeRow}
						กะวันที่ {removeRow.shift.date} เวลา {removeRow.shift.start_time}–{removeRow.shift
							.end_time} น. (เป้า {removeRow.shift.quota} คน) จะถูกลบออก และโควตารวมของงานจะลดลงตาม
						{#if removeCascade.length > 0}
							<span class="mt-2 block font-bold text-foreground">
								ระบบจะถอดอาสาที่มอบหมายไว้ในกะนี้ {removeCascade.length} คนออกอัตโนมัติ ({removeCascade
									.map((e) => e.volunteerName)
									.join(', ')}) และคืนที่นั่งเข้าโควตาของงาน
							</span>
						{/if}
						{#if removeBlocking.length > 0}
							<span class="mt-2 block font-bold text-destructive">
								กะนี้มีอาสาเช็คอิน/ปฏิบัติงานเสร็จแล้ว {removeBlocking.length} คน ({removeBlocking
									.map((e) => e.volunteerName)
									.join(', ')}) — ระบบจะไม่ถอดออกให้อัตโนมัติ เพื่อรักษาประวัติการเข้าเวร
								ลบกะนี้ไม่ได้จนกว่าจะจัดการรายชื่อเหล่านี้ก่อน
							</span>
						{/if}
						{#if removeOverflow.needed > 0 && !removeOverflowBlocked}
							<span class="mt-2 block font-bold text-foreground">
								โควตารวมของงานจะเหลือน้อยกว่าที่อาสาถืออยู่ในกะอื่นของงานนี้อีก {removeOverflow.needed}
								ที่นั่ง — ระบบจะถอดอาสาที่มอบหมายล่าสุดในกะอื่น {removeOverflow.candidates.length} คนออก
								ด้วย ({removeOverflow.candidates.map((e) => e.volunteerName).join(', ')})
							</span>
						{/if}
						{#if removeOverflowBlocked}
							<span class="mt-2 block font-bold text-destructive">
								ลบกะนี้ไม่ได้ — โควตารวมของงานจะเหลือน้อยกว่าที่อาสาถืออยู่ในกะอื่นอีก
								{removeOverflow.needed} ที่นั่ง แต่มีอาสาที่ยังพอถอดได้ (ยังไม่เช็คอิน) เหลือเพียง
								{removeOverflow.candidates.length} คน กรุณาเพิ่มโควตา หรือจัดการอาสาในกะอื่นก่อน
							</span>
						{/if}
					{/if}
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>ยกเลิก</AlertDialog.Cancel>
				<AlertDialog.Action
					class="bg-destructive text-white hover:bg-destructive/90"
					disabled={saving || removeBlocking.length > 0 || removeOverflowBlocked}
					onclick={confirmRemove}
				>
					ยืนยันลบกะนี้
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<AlertDialog.Root
		open={unassignTarget !== null}
		onOpenChange={(next) => {
			if (!next) unassignTarget = null;
		}}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title class="flex items-center gap-2">
					<TriangleAlert class="h-4.5 w-4.5 text-destructive" />
					ลบอาสาออกจากกะนี้?
				</AlertDialog.Title>
				<AlertDialog.Description>
					{#if unassignTarget}
						{unassignTarget.volunteerName} ({unassignTarget.volunteerCode}) จะถูกถอดออกจากกะนี้
						และที่นั่งจะถูกคืนเข้าโควตาของงานทันที
					{/if}
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>ยกเลิก</AlertDialog.Cancel>
				<AlertDialog.Action
					class="bg-destructive text-white hover:bg-destructive/90"
					disabled={unassignMutation.isPending}
					onclick={confirmUnassign}
				>
					ยืนยันลบออกจากกะ
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>

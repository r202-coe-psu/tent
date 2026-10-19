<script lang="ts">
	/**
	 * Job detail — Tab 2 "กะและตารางกะ (Shifts & Schedule)" (01-tab-job-board.md
	 * §01.5 "ตารางกะของงานนี้", approved mockup 2026-08-27).
	 *
	 * Adds/removes sub-shifts on an existing job. New shifts are built as cards in
	 * `ShiftCardList` — the same component and rules (`domain/shift-draft.ts`) the
	 * create/edit form uses, so the two screens can never drift (#624) — and are
	 * written in one update when the user saves them.
	 *
	 * Every write goes through `useUpdateJob`: the job's
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
	import Check from '@lucide/svelte/icons/check';
	import CalendarRange from '@lucide/svelte/icons/calendar-range';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ulid } from '$lib/db/ulid';
	import { errorMessage } from '$lib/utils/errors';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import JobShiftCard from './job-shift-card.svelte';
	import JobShiftEditDialog from './job-shift-edit-dialog.svelte';
	import JobShiftRosterDialog from './job-shift-roster-dialog.svelte';
	import { jobShiftQuotaSplits } from '../domain/capacity';
	import { shiftRoster, type ShiftRosterEntry } from '../domain/shift-roster';
	import { totalShiftQuota, type Job, type JobShift } from '../domain/job.schema';
	import { firstShiftCardError, shiftCardErrors } from '../domain/shift-draft';
	import ShiftCardList from './shift-card-list.svelte';
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

	/** New shifts being built as cards; written to the job only on "บันทึก". */
	let draftShifts = $state<JobShift[]>([]);
	/** Set by a save attempt — from then on every draft card shows its error. */
	let showDraftErrors = $state(false);

	/**
	 * Assigning volunteers lives on its own page. `resolve()` in this SvelteKit version only
	 * prefixes `base`, so the `[id]` segment is built here — `job._id` contains
	 * a colon, hence the encode (same as `job-card.svelte`).
	 */
	function openAssign(shiftId?: string) {
		const query = shiftId ? `?shift=${encodeURIComponent(shiftId)}` : '';
		goto(resolve(`/back-office/volunteers/jobs/${encodeURIComponent(job._id)}/assign${query}`));
	}

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
			toast.error(`ลบออกจากกะไม่สำเร็จ: ${errorMessage(err)}`);
		}
	}

	/** One place that writes `shifts` — `quota` is always re-derived from the rows. */
	async function persistShifts(shifts: JobShift[], successMessage: string): Promise<boolean> {
		try {
			await updateMutation.mutateAsync({ ...job, shifts, quota: totalShiftQuota(shifts) });
			toast.success(successMessage);
			return true;
		} catch (err) {
			toast.error(`บันทึกกะไม่สำเร็จ: ${errorMessage(err)}`);
			return false;
		}
	}

	/**
	 * Write the draft cards onto the job in one update. Every card is checked
	 * first — against the other drafts and the shifts already saved — and the
	 * toast names the first broken card ("กะที่ 2: …").
	 */
	async function saveDrafts() {
		if (saving || draftShifts.length === 0) return;
		const problem = firstShiftCardError(
			draftShifts,
			shiftCardErrors(draftShifts, { existing: job.shifts })
		);
		if (problem) {
			showDraftErrors = true;
			toast.error(`บันทึกไม่ได้ — ${problem}`);
			return;
		}
		const count = draftShifts.length;
		if (await persistShifts([...job.shifts, ...draftShifts], `เพิ่ม ${count} กะเข้างานแล้ว`)) {
			draftShifts = [];
			showDraftErrors = false;
		}
	}

	function discardDrafts() {
		draftShifts = [];
		showDraftErrors = false;
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
	/** The edit guard must use this concrete shift's roster, not job-level counters. */
	const editMinQuota = $derived(editRow ? editRow.roster.length : 0);

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
					dispatchStatus: a.dispatch_status ?? null,
					phone: volunteer?.phone ?? null,
					station: a.station,
					checkInAt: a.check_in_at ?? null,
					checkOutAt: a.check_out_at ?? null
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
</script>

<div class="space-y-4">
	<div class="rounded-2xl border border-border bg-card p-4 shadow-xs">
		<div>
			<h3 class="inline-flex items-center gap-2 text-sm font-bold text-foreground">
				<Layers class="h-4 w-4 text-primary" />
				เครื่องมือเพิ่มกะย่อย (Shifts Generator)
			</h3>
			<p class="mt-1 text-sm text-muted-foreground">
				เพิ่มกะใหม่เป็นการ์ดและแก้ไขในการ์ดได้เลย แล้วกดบันทึกครั้งเดียว —
				กะที่บันทึกแล้วอยู่ในรายการด้านล่าง
			</p>
		</div>

		<div class="mt-4">
			<ShiftCardList
				bind:shifts={draftShifts}
				existing={job.shifts}
				showAllErrors={showDraftErrors}
				idFactory={() => `js-${ulid()}`}
				disabled={saving}
				emptyHint="กด &quot;เพิ่มกะ&quot; หรือสร้างกะเป็นช่วงวัน แล้วกดบันทึกเพื่อเพิ่มเข้างานนี้"
			/>
		</div>

		{#if draftShifts.length > 0}
			<div class="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button variant="ghost" class="min-h-11" disabled={saving} onclick={discardDrafts}>
					ล้างกะที่ยังไม่บันทึก
				</Button>
				<Button class="min-h-11 gap-1.5 sm:min-w-[220px]" disabled={saving} onclick={saveDrafts}>
					<Check class="h-4 w-4" />
					{saving ? 'กำลังบันทึก...' : `บันทึก ${draftShifts.length} กะเข้างานนี้`}
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
		jobTitle={job.title}
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

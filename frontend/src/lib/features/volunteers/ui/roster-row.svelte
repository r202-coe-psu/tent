<script lang="ts">
	/**
	 * Roster & Live Attendance tab (Tab 2) — one row of "แถบสแกนและค้นหาด่วน
	 * (Fast Scan & Live Roster)". Joins one TODAY `shift_assignment` with its
	 * `volunteer` (and, when resolvable, its `job` title) — purely presentational,
	 * mirrors `assign-roster-row.svelte`'s "never inspects data itself" split.
	 *
	 * Action gating (owner-approved mockup, 2026-08-29, reusing the same
	 * identity-gate `volunteer-card.svelte`'s People tab already renders):
	 *   - `!volunteer.identity_verified` blocks only a FRESH check-in
	 *     (`assigned`/`standby` → locked "รอยืนยันตัวตน" badge, จนท. ต้องตรวจบัตร
	 *     ปชช. ก่อน) — it must NOT hide a check-out affordance for someone
	 *     already `checked_in`/`completed` (e.g. seeded/legacy data checked in
	 *     before verification existed), so `blockedByIdentity` below only ever
	 *     applies to the not-yet-on-shift statuses.
	 *   - `assigned`/`standby` (verified) → 1-click "เช็คอินเข้างาน" (`useCheckIn`,
	 *     default `method: 'qr'`) + "เช็คอินแทน" opens
	 *     `roster-manual-checkin-dialog.svelte` (`method: 'manual_override'`,
	 *     requires a reason — FR-VOL-11.2).
	 *   - `checked_in` → 1-click "เช็คเอาต์ออกงาน" (`useCheckOut`) + "เช็คเอาต์แทน"
	 *     (same dialog, `check_out` mode — see its header comment for why that
	 *     mode carries no reason field) — available regardless of identity
	 *     verification, per the point above.
	 *   - `completed`/`no_show`/`cancelled` → final-state badge only.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import History from '@lucide/svelte/icons/history';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Lock from '@lucide/svelte/icons/lock';
	import Phone from '@lucide/svelte/icons/phone';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import RosterManualCheckinDialog from './roster-manual-checkin-dialog.svelte';
	import { useCheckIn, useCheckOut, useSkillOptions } from '../application/queries';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';
	import type { Volunteer } from '../domain/volunteer.schema';
	import type {
		ShiftAssignment,
		ShiftAssignmentStatus,
		ShiftKind
	} from '../domain/shift-assignment.schema';

	let {
		assignment,
		volunteer,
		jobTitle,
		onhistory
	}: {
		assignment: ShiftAssignment;
		volunteer: Volunteer;
		/** Resolved `job.title` for `assignment.job_id`, or `undefined` when the job can't be resolved (e.g. `job_id: 'legacy'`). */
		jobTitle: string | undefined;
		onhistory: (volunteerId: string) => void;
	} = $props();

	const SHIFT_LABELS: Record<ShiftKind, string> = {
		morning: 'กะเช้า (08:00–16:00)',
		afternoon: 'กะบ่าย (16:00–00:00)',
		night: 'กะดึก (00:00–08:00)',
		flex: 'ยืดหยุ่น (Flex)',
		custom: 'กะกำหนดเอง'
	};

	const STATUS_LABELS: Record<ShiftAssignmentStatus, string> = {
		assigned: 'รับกะแล้ว',
		standby: 'รอสแตนด์บาย',
		checked_in: 'ปฏิบัติหน้าที่อยู่',
		completed: 'เสร็จสิ้นภารกิจ',
		no_show: 'ขาดปฏิบัติงาน',
		cancelled: 'ยกเลิก'
	};

	// The identity gate only blocks a FRESH check-in (FR-VOL-11 "ต้องตรวจบัตร ปชช.
	// ก่อนเข้ากะ") — it must not hide a check-out affordance for someone who is
	// already `checked_in`/`completed` (e.g. seeded/legacy data where a volunteer
	// was checked in before verification), so this only applies to the
	// not-yet-on-shift statuses, not the assignment's status as a whole.
	const notYetOnShift = $derived(
		assignment.status === 'assigned' || assignment.status === 'standby'
	);
	const blockedByIdentity = $derived(!volunteer.identity_verified && notYetOnShift);

	const fullName = $derived(`${volunteer.first_name} ${volunteer.last_name}`.trim());
	const phoneLast4 = $derived(volunteer.phone ? volunteer.phone.slice(-4) : null);

	function formatTime(ts: string): string {
		return new Date(ts).toLocaleTimeString('th-TH', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Bangkok'
		});
	}

	const dutyWindowLabel = $derived(
		`${formatTime(assignment.duty_window.start_ts)}–${formatTime(assignment.duty_window.end_ts)} น.`
	);
	const skillCatalog = useSkillOptions();
	const skills = $derived.by<SkillOption[]>(() => {
		// This map is a local deduplication buffer and is not exposed to the template.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, SkillOption>();
		for (const value of volunteer.skills) {
			const option = resolveSkillOption(value, skillCatalog.options);
			if (option && !map.has(option.code)) {
				map.set(option.code, option);
			}
		}
		return Array.from(map.values());
	});

	const queryClient = useQueryClient();
	const checkInMutation = useCheckIn(queryClient);
	const checkOutMutation = useCheckOut(queryClient);

	async function checkInNow() {
		try {
			await checkInMutation.mutateAsync({ id: assignment._id });
			toast.success(`เช็คอินเข้างาน ${fullName} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คอินไม่สำเร็จ');
		}
	}

	async function checkOutNow() {
		try {
			await checkOutMutation.mutateAsync(assignment._id);
			toast.success(`เช็คเอาต์ออกงาน ${fullName} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คเอาต์ไม่สำเร็จ');
		}
	}

	let manualDialogOpen = $state(false);
	let manualMode = $state<'check_in' | 'check_out'>('check_in');
	function openManual(mode: 'check_in' | 'check_out') {
		manualMode = mode;
		manualDialogOpen = true;
	}
</script>

<div
	class="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs lg:grid-cols-[minmax(0,2fr)_minmax(0,1.8fr)_minmax(0,1.8fr)_minmax(0,1.8fr)] lg:items-start lg:gap-4"
>
	<!-- ข้อมูลอาสาสมัคร -->
	<div class="min-w-0 space-y-1">
		<div class="flex items-center gap-1.5">
			<span
				class="h-2 w-2 shrink-0 rounded-full {volunteer.checked_in
					? 'bg-emerald-500'
					: 'bg-slate-300'}"
			></span>
			<span class="text-sm font-bold break-words text-foreground">{fullName}</span>
			<Badge variant="outline" class="text-[11px]">
				{volunteer.personnel_type === 'staff' ? 'จนท.' : 'อาสา'}
			</Badge>
		</div>
		<p class="pl-3.5 text-xs text-muted-foreground">ID: {volunteer.volunteer_code}</p>
		{#if phoneLast4}
			<p class="flex items-center gap-1.5 pl-3.5 text-xs text-muted-foreground">
				<Phone class="h-3.5 w-3.5" />
				{volunteer.phone}
			</p>
		{/if}
	</div>

	<!-- กะ / ภารกิจ -->
	<div class="min-w-0 space-y-1">
		<p class="text-sm font-semibold break-words text-foreground">
			{jobTitle ?? assignment.station}
		</p>
		<p class="text-xs text-muted-foreground">
			{dutyWindowLabel} ({SHIFT_LABELS[assignment.shift]})
		</p>
		{#if skills.length > 0}
			<p class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
				<span>ทักษะ:</span>
				{#each skills as skill, i (`${skill.code}-${i}`)}
					<span>{skill.icon}{skill.label}{i < skills.length - 1 ? ',' : ''}</span>
				{/each}
			</p>
		{/if}
	</div>

	<!-- สถานะยืนยันตัวตน & กะงาน -->
	<div class="space-y-1.5">
		<div class="flex flex-wrap items-center gap-1.5">
			{#if volunteer.identity_verified}
				<Badge
					class="gap-1 border-emerald-300 bg-emerald-50 text-[11px] text-emerald-700"
					variant="outline"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					ยืนยันตัวตนแล้ว
				</Badge>
			{:else}
				<Badge
					class="gap-1 border-amber-300 bg-amber-50 text-[11px] text-amber-700"
					variant="outline"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
					รอยืนยันตัวตน
				</Badge>
			{/if}

			{#if blockedByIdentity}
				<Badge variant="outline" class="gap-1 text-[11px] text-muted-foreground">
					<Lock class="h-3 w-3" />
					รอสแตนด์บาย
				</Badge>
			{:else if assignment.status === 'checked_in'}
				<Badge
					class="gap-1 border-emerald-300 bg-emerald-50 text-[11px] text-emerald-700"
					variant="outline"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					{STATUS_LABELS[assignment.status]}
				</Badge>
			{:else if assignment.status === 'assigned' || assignment.status === 'standby'}
				<Badge class="gap-1 border-sky-300 bg-sky-50 text-[11px] text-sky-700" variant="outline">
					<span class="h-1.5 w-1.5 rounded-full bg-sky-400"></span>
					{STATUS_LABELS[assignment.status]}
				</Badge>
			{:else}
				<Badge variant="outline" class="gap-1 text-[11px] text-muted-foreground">
					{STATUS_LABELS[assignment.status]}
				</Badge>
			{/if}
		</div>

		{#if blockedByIdentity}
			<p class="text-[11px] text-amber-700">ต้องให้ จนท. ตรวจบัตร ปชช. ก่อนเข้ากะ</p>
		{:else if assignment.status === 'checked_in' && assignment.check_in_at}
			<p class="text-xs text-muted-foreground">
				เข้า: {formatTime(assignment.check_in_at)} น. ({assignment.check_in_method ===
				'manual_override'
					? 'จนท. บันทึกแทน'
					: 'ระบบตนเอง'})
			</p>
		{:else if assignment.status === 'completed' && assignment.check_out_at}
			<p class="text-xs text-muted-foreground">
				ออกกะล่าสุด: {formatTime(assignment.check_out_at)} น.
			</p>
		{/if}
	</div>

	<!-- การดำเนินการ (1-CLICK ACTION) -->
	<div class="flex flex-wrap items-center gap-1.5 lg:flex-col lg:items-stretch">
		<div class="flex items-center gap-1.5">
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								size="icon"
								variant="outline"
								class="shrink-0"
								onclick={() => onhistory(volunteer._id)}
							>
								<History class="h-4 w-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>ประวัติเช็คอิน/เช็คเอาต์ของอาสาคนนี้</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>

			{#if blockedByIdentity}
				<Badge variant="outline" class="gap-1.5 px-3 py-2 text-[11px] font-bold text-amber-700">
					<Lock class="h-3.5 w-3.5" />
					รอยืนยันตัวตน
				</Badge>
			{:else if assignment.status === 'checked_in'}
				<Button
					size="sm"
					class="flex-1 gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
					disabled={checkOutMutation.isPending}
					onclick={checkOutNow}
				>
					<LogOut class="h-3.5 w-3.5" />
					เช็คเอาต์ออกงาน
				</Button>
			{:else if assignment.status === 'assigned' || assignment.status === 'standby'}
				<Button
					size="sm"
					class="flex-1 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
					disabled={checkInMutation.isPending}
					onclick={checkInNow}
				>
					<LogIn class="h-3.5 w-3.5" />
					เช็คอินเข้างาน
				</Button>
			{:else}
				<Badge variant="outline" class="px-3 py-2 text-[11px] text-muted-foreground">
					{STATUS_LABELS[assignment.status]}
				</Badge>
			{/if}
		</div>

		{#if !blockedByIdentity && (assignment.status === 'checked_in' || assignment.status === 'assigned' || assignment.status === 'standby')}
			<Button
				size="sm"
				variant="outline"
				class="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
				onclick={() => openManual(assignment.status === 'checked_in' ? 'check_out' : 'check_in')}
			>
				{assignment.status === 'checked_in' ? 'เช็คเอาต์แทน' : 'เช็คอินแทน'}
			</Button>
		{/if}
	</div>
</div>

<RosterManualCheckinDialog
	bind:open={manualDialogOpen}
	mode={manualMode}
	assignmentId={assignment._id}
	volunteerName={fullName}
/>

<script lang="ts">
	/**
	 * Tab 2 — "ตารางกะและเช็คอินจิตอาสา (Roster & Live Attendance)"
	 * (owner-approved mockup, 2026-08-29). Composes the Today's Live Attendance
	 * Bar, the Fast Scan & Live Roster search/filter bar, and the roster list;
	 * owns the Check-In Audit Trail dialog.
	 *
	 * The 3 attendance-bar tiles reuse `useHubMetrics()`'s `checkedInNow` /
	 * `assigned` / `completed` fields — `domain/hub-metrics.ts#computeHubMetrics`
	 * is the ONLY function allowed to produce these counters (CR-094 FR-VOL-08.2
	 * / AC-094-09); this tab must not recompute them from `useTodayAttendance()`
	 * itself even though it also fetches that list for the row-level detail.
	 * Those 3 tiles therefore ALWAYS describe today; the roster list below them
	 * can be moved to another date with the date filter, so a non-today view
	 * says so explicitly instead of letting the tiles read as that day's totals.
	 *
	 * Deliberately out of scope for this pass (owner instruction 2026-08-29 —
	 * mock up only, no real hardware/kiosk build yet):
	 *   - "เปิดหน้าจอเช็คอินหน้างาน (On-Site Kiosk)" — stays a `toast.info` stub.
	 *     The separate on-site kiosk screen (`/onsite/volunteer-check-in`) is
	 *     its own route/feature, not wired from here.
	 *   - "สแกนรับเข้างาน" camera scan — see `roster-scan-bar.svelte`.
	 * Everything else (the roster list's 1-click check-in/out, manual override,
	 * and the audit trail) is wired to real `shift_assignment` data/mutations —
	 * see `roster-row.svelte` / `roster-audit-trail-dialog.svelte`.
	 *
	 * Also deliberately NOT built: a "โหมดสาธิต / demo mode" RBAC-unlock banner.
	 * `volunteer-hub-header.svelte` already documents this as a mockup-only
	 * artifact excluded by CR-094 FR-VOL-08.7 (this app enforces RBAC for real,
	 * server-side — there is no "temporarily unlock everything" mode to render).
	 */
	import { toast } from 'svelte-sonner';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Monitor from '@lucide/svelte/icons/monitor';
	import History from '@lucide/svelte/icons/history';
	import Info from '@lucide/svelte/icons/info';
	import Inbox from '@lucide/svelte/icons/inbox';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import RosterLiveAttendanceBar from './roster-live-attendance-bar.svelte';
	import RosterScanBar from './roster-scan-bar.svelte';
	import RosterRow from './roster-row.svelte';
	import RosterAuditTrailDialog from './roster-audit-trail-dialog.svelte';
	import {
		useHubMetrics,
		todayDateString,
		useTodayAttendance,
		useShiftAssignments,
		useVolunteers,
		useJobs
	} from '../application/queries';
	import type {
		ShiftAssignment,
		ShiftAssignmentStatus,
		ShiftKind
	} from '../domain/shift-assignment.schema';

	let dateFilter = $state(todayDateString());
	const isToday = $derived(dateFilter === todayDateString());

	const hubMetrics = useHubMetrics();
	const attendanceQuery = useTodayAttendance(() => dateFilter);
	const allAssignmentsQuery = useShiftAssignments();
	const volunteersQuery = useVolunteers();
	const jobsQuery = useJobs();

	const volunteersById = $derived.by(() => {
		const map = new Map(volunteersQuery.data?.map((v) => [v._id, v]) ?? []);
		return map;
	});
	const jobTitleById = $derived.by(() => {
		const map = new Map(jobsQuery.data?.map((j) => [j._id, j.title]) ?? []);
		return map;
	});

	let search = $state('');
	let shiftFilter = $state<ShiftKind | ''>('');
	let statusFilter = $state<ShiftAssignmentStatus | ''>('');

	function matchesSearch(assignment: ShiftAssignment, term: string): boolean {
		if (!term) return true;
		const v = volunteersById.get(assignment.volunteer_id);
		if (!v) return false;
		const needle = term.trim().toLowerCase();
		if (!needle) return true;
		return (
			`${v.first_name} ${v.last_name}`.toLowerCase().includes(needle) ||
			v.volunteer_code.toLowerCase().includes(needle) ||
			(v.phone ?? '').includes(needle)
		);
	}

	// Priority order roughly matching the owner-approved mockup: on-site first,
	// then still-expected, then wrapped-up/no-show/cancelled last.
	const STATUS_PRIORITY: Record<ShiftAssignmentStatus, number> = {
		checked_in: 0,
		assigned: 1,
		standby: 1,
		completed: 2,
		no_show: 3,
		cancelled: 4
	};

	const rows = $derived.by(() => {
		let list = (attendanceQuery.data ?? []).filter((a) => volunteersById.has(a.volunteer_id));
		if (shiftFilter) list = list.filter((a) => a.shift === shiftFilter);
		if (statusFilter) list = list.filter((a) => a.status === statusFilter);
		if (search) list = list.filter((a) => matchesSearch(a, search));
		return [...list].sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
	});

	const isLoading = $derived(attendanceQuery.isPending || volunteersQuery.isPending);

	function openKiosk() {
		toast.info(
			'เปิดหน้าจอเช็คอินหน้างาน (On-Site Kiosk) — ฟีเจอร์นี้อยู่ระหว่างการพัฒนา (mock up)'
		);
	}

	let auditDialogOpen = $state(false);
	let auditPresetVolunteerId = $state<string | null>(null);
	function openAudit(volunteerId: string | null = null) {
		auditPresetVolunteerId = volunteerId;
		auditDialogOpen = true;
	}

	const auditEventCount = $derived.by(() => {
		let n = 0;
		for (const a of allAssignmentsQuery.data ?? []) {
			if (a.check_in_at) n += 1;
			if (a.check_out_at) n += 1;
		}
		return n;
	});
</script>

<div class="space-y-4">
	<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
					<CalendarDays class="h-4.5 w-4.5" />
				</div>
				<h2 class="text-lg font-bold text-foreground">
					ตารางกะและเช็คอินจิตอาสา (Roster &amp; Live Attendance)
				</h2>
			</div>
			<Badge
				variant="outline"
				class="mt-2 gap-1.5 border-emerald-300 bg-emerald-50 text-[11px] text-emerald-700"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
				Live On-Site Tracking
			</Badge>
			<p class="mt-1.5 max-w-2xl text-xs text-muted-foreground">
				ติดตามสถานะรายงานตัวเข้ากะสดประจำวัน พร้อมระบบสแกน QR 1-Click และ "เช็คอินแทน (Manual
				Override)" ที่มี Audit Trail สมบูรณ์
			</p>
		</div>

		<div class="flex shrink-0 flex-wrap items-center gap-2">
			<Button
				class="gap-1.5 bg-primary-dark text-white hover:bg-primary-dark/90"
				onclick={openKiosk}
			>
				<Monitor class="h-4 w-4" />
				เปิดหน้าจอเช็คอินหน้างาน (On-Site Kiosk)
			</Button>
			<Button variant="outline" class="gap-1.5" onclick={() => openAudit(null)}>
				<History class="h-4 w-4" />
				ประวัติ Audit Trail ({auditEventCount})
			</Button>
		</div>
	</div>

	<RosterLiveAttendanceBar
		activeOnSite={hubMetrics.data?.checkedInNow ?? 0}
		expectedToday={hubMetrics.data?.assigned ?? 0}
		completed={hubMetrics.data?.completed ?? 0}
		isPending={hubMetrics.isPending}
	/>

	<RosterScanBar
		bind:search
		bind:shift={shiftFilter}
		bind:status={statusFilter}
		bind:date={dateFilter}
	/>

	{#if !isToday}
		<div
			class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-amber-900"
		>
			<CalendarDays class="mt-0.5 h-4 w-4 shrink-0" />
			<p class="text-xs">
				กำลังดูตารางกะของวันที่ <span class="font-bold">{dateFilter}</span> (ไม่ใช่วันนี้) — ตัวเลขสรุป
				3 ช่องด้านบนยังนับเฉพาะวันนี้เสมอ
			</p>
		</div>
	{/if}

	<div
		class="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-sky-900"
	>
		<Info class="mt-0.5 h-4 w-4 shrink-0" />
		<p class="text-xs">
			หลักเกณฑ์การทำงานร่วมกัน: สามารถใช้ปุ่ม "เช็คอินเข้างาน" หรือ "เช็คเอาต์ออกงาน"
			ด้านล่างเพื่อบันทึกสถานะได้แบบ 1-Click ทันที หรือกดปุ่ม "เช็คอินแทน" เพื่อลงบันทึกเหตุผลพิเศษ
			(Audit Trail) ในกรณีอุปกรณ์ขัดข้อง
		</p>
	</div>

	{#if isLoading}
		<div class="space-y-3">
			{#each [0, 1, 2, 3] as key (key)}
				<Skeleton class="h-28 rounded-2xl" />
			{/each}
		</div>
	{:else if attendanceQuery.isError}
		<p
			class="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
		>
			โหลดตารางกะไม่สำเร็จ: {attendanceQuery.error instanceof Error
				? attendanceQuery.error.message
				: 'เกิดข้อผิดพลาด'}
		</p>
	{:else if rows.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground"
		>
			<Inbox class="h-8 w-8" />
			<p class="text-sm font-medium">
				{(attendanceQuery.data ?? []).length === 0
					? isToday
						? 'ยังไม่มีตารางกะของวันนี้'
						: `ไม่มีตารางกะของวันที่ ${dateFilter}`
					: 'ไม่มีรายการที่ตรงกับตัวกรองที่เลือก'}
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each rows as assignment (assignment._id)}
				{@const volunteer = volunteersById.get(assignment.volunteer_id)}
				{#if volunteer}
					<RosterRow
						{assignment}
						{volunteer}
						jobTitle={jobTitleById.get(assignment.job_id)}
						onhistory={(volunteerId) => openAudit(volunteerId)}
					/>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<RosterAuditTrailDialog
	bind:open={auditDialogOpen}
	assignments={allAssignmentsQuery.data ?? []}
	{volunteersById}
	initialVolunteerId={auditPresetVolunteerId}
/>

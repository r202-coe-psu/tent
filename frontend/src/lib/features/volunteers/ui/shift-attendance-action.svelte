<script lang="ts">
	/**
	 * The attendance action for one `shift_assignment` on the job detail "ผู้สมัคร" tab:
	 * check the volunteer in or out, ask for identity verification first, or just show where
	 * the assignment stands. Check-in and check-out are confirmed in a dialog before saving. `attendance` comes from `applicantAttendance` (approved rows) or
	 * `assignmentAttendance` (staff-assigned rows); `kind: 'none'` renders nothing.
	 */
	import Lock from '@lucide/svelte/icons/lock';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useShelter } from '$lib/features/shelters';
	import type { ApplicantAttendance } from '../domain/applicant-attendance';
	import type { ShiftAssignmentStatus } from '../domain/shift-assignment.schema';
	import type { Volunteer } from '../domain/volunteer.schema';
	import ApplicantCheckInDialog from './applicant-check-in-dialog.svelte';
	import ApplicantCheckOutDialog from './applicant-check-out-dialog.svelte';
	import VolunteerQualificationDialog from './volunteer-qualification-dialog.svelte';

	let {
		attendance,
		volunteer,
		personName,
		shiftLabel
	}: {
		attendance: ApplicantAttendance;
		/** Roster profile; the verify dialog needs it, so verifying is disabled without one. */
		volunteer: Volunteer | null;
		/** Named in the check-in / check-out dialog and toast. */
		personName: string;
		/** e.g. `2026-09-05 · 08:00 - 16:00 น.`, shown in the check-in / check-out dialog. */
		shiftLabel: string;
	} = $props();

	const ASSIGNMENT_STATUS_LABELS: Record<ShiftAssignmentStatus, string> = {
		assigned: 'รับกะแล้ว',
		standby: 'รอสแตนด์บาย',
		checked_in: 'ปฏิบัติหน้าที่อยู่',
		completed: 'เสร็จสิ้นงานอาสาสมัคร',
		no_show: 'ขาดปฏิบัติงาน',
		cancelled: 'ยกเลิก'
	};

	let checkInOpen = $state(false);
	let checkOutOpen = $state(false);

	// Same gate as the roster tab. Verifying invalidates the volunteers query, so the
	// "รอยืนยันตัวตน" button turns into "เช็คอินเข้างาน" without a reload.
	let verifyOpen = $state(false);

	// Only a row that can open the dialog needs the shelter; the query is shared with the roster.
	const shelterQuery = useShelter(
		() => volunteer?.shelter_code ?? '',
		() => attendance.kind === 'verify' && volunteer !== null
	);
	const shelterLine = $derived.by(() => {
		const shelter = shelterQuery.data;
		if (!shelter?.name) return '—';
		return shelter.shelter_type ? `${shelter.name} (${shelter.shelter_type})` : shelter.name;
	});
</script>

{#if attendance.kind === 'check-in'}
	<Button
		size="sm"
		class="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
		onclick={() => (checkInOpen = true)}
	>
		<LogIn class="h-3.5 w-3.5" />
		เช็คอินเข้างาน
	</Button>
{:else if attendance.kind === 'check-out'}
	<Button
		size="sm"
		class="h-9 gap-1 bg-amber-500 text-white hover:bg-amber-600"
		onclick={() => (checkOutOpen = true)}
	>
		<LogOut class="h-3.5 w-3.5" />
		เช็คเอาต์ออกงาน
	</Button>
{:else if attendance.kind === 'verify'}
	<Button
		size="sm"
		variant="outline"
		class="h-9 gap-1 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800"
		disabled={!volunteer}
		onclick={() => (verifyOpen = true)}
	>
		<Lock class="h-3.5 w-3.5" />
		รอยืนยันตัวตน
	</Button>
{:else if attendance.kind === 'status'}
	<span
		class="rounded-full bg-muted px-2.5 py-1 text-2xs font-bold text-muted-foreground ring-1 ring-border"
	>
		{ASSIGNMENT_STATUS_LABELS[attendance.assignment.status]}
	</span>
{/if}

{#if attendance.kind === 'check-in'}
	<ApplicantCheckInDialog
		bind:open={checkInOpen}
		assignment={attendance.assignment}
		{volunteer}
		{personName}
		{shiftLabel}
	/>
{:else if attendance.kind === 'check-out'}
	<ApplicantCheckOutDialog
		bind:open={checkOutOpen}
		assignment={attendance.assignment}
		{volunteer}
		{personName}
		{shiftLabel}
	/>
{/if}

{#if volunteer}
	<VolunteerQualificationDialog bind:open={verifyOpen} {volunteer} {shelterLine} />
{/if}

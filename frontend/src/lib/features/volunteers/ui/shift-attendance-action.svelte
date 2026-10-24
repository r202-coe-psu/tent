<script lang="ts">
	/**
	 * The attendance action for one `shift_assignment` on the job detail "ผู้สมัคร" tab:
	 * check the volunteer in or out, ask for identity verification first, or just show where
	 * the assignment stands. `attendance` comes from `applicantAttendance` (approved rows) or
	 * `assignmentAttendance` (staff-assigned rows); `kind: 'none'` renders nothing.
	 */
	import Lock from '@lucide/svelte/icons/lock';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useCheckIn, useCheckOut } from '../application/queries';
	import type { ApplicantAttendance } from '../domain/applicant-attendance';
	import type { ShiftAssignmentStatus } from '../domain/shift-assignment.schema';
	import type { Volunteer } from '../domain/volunteer.schema';
	import VolunteerQualificationDialog from './volunteer-qualification-dialog.svelte';

	let {
		attendance,
		volunteer,
		personName
	}: {
		attendance: ApplicantAttendance;
		/** Roster profile; the verify dialog needs it, so verifying is disabled without one. */
		volunteer: Volunteer | null;
		/** Named in the check-in / check-out toast. */
		personName: string;
	} = $props();

	const ASSIGNMENT_STATUS_LABELS: Record<ShiftAssignmentStatus, string> = {
		assigned: 'รับกะแล้ว',
		standby: 'รอสแตนด์บาย',
		checked_in: 'ปฏิบัติหน้าที่อยู่',
		completed: 'เสร็จสิ้นงานอาสาสมัคร',
		no_show: 'ขาดปฏิบัติงาน',
		cancelled: 'ยกเลิก'
	};

	const queryClient = useQueryClient();
	const checkInMutation = useCheckIn(queryClient);
	const checkOutMutation = useCheckOut(queryClient);

	async function checkInNow(assignmentId: string) {
		try {
			await checkInMutation.mutateAsync({ id: assignmentId });
			toast.success(`เช็คอินเข้างาน ${personName} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คอินไม่สำเร็จ');
		}
	}

	async function checkOutNow(assignmentId: string) {
		try {
			await checkOutMutation.mutateAsync({ id: assignmentId });
			toast.success(`เช็คเอาต์ออกงาน ${personName} แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คเอาต์ไม่สำเร็จ');
		}
	}

	// Same gate as the roster tab. Verifying invalidates the volunteers query, so the
	// "รอยืนยันตัวตน" button turns into "เช็คอินเข้างาน" without a reload.
	let verifyOpen = $state(false);
</script>

{#if attendance.kind === 'check-in'}
	<Button
		size="sm"
		class="h-9 gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
		disabled={checkInMutation.isPending}
		onclick={() => checkInNow(attendance.assignment._id)}
	>
		<LogIn class="h-3.5 w-3.5" />
		เช็คอินเข้างาน
	</Button>
{:else if attendance.kind === 'check-out'}
	<Button
		size="sm"
		class="h-9 gap-1 bg-amber-500 text-white hover:bg-amber-600"
		disabled={checkOutMutation.isPending}
		onclick={() => checkOutNow(attendance.assignment._id)}
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

{#if volunteer}
	<VolunteerQualificationDialog bind:open={verifyOpen} {volunteer} shelterLine="—" />
{/if}

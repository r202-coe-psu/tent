<script lang="ts">
	/**
	 * Check-out confirmation for one applicant shift (applicants tab, #840). No QR or
	 * reason is needed to leave a shift, so this is a plain "are you sure" showing who,
	 * which shift and when they checked in.
	 *
	 * Self-contained like `applicant-check-in-dialog.svelte` (owns its mutation and toasts).
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import IdCard from '@lucide/svelte/icons/id-card';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { useCheckOut } from '../application/queries';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';
	import type { Volunteer } from '../domain/volunteer.schema';

	let {
		open = $bindable(false),
		assignment,
		volunteer = null,
		personName,
		shiftLabel
	}: {
		open?: boolean;
		assignment: ShiftAssignment;
		/** Roster profile, for the volunteer code. */
		volunteer?: Volunteer | null;
		personName: string;
		/** e.g. `2026-09-05 · 08:00 - 16:00 น.` — formatted by the caller. */
		shiftLabel: string;
	} = $props();

	const queryClient = useQueryClient();
	const checkOutMutation = useCheckOut(queryClient);

	async function confirm() {
		try {
			await checkOutMutation.mutateAsync({ id: assignment._id });
			toast.success(`เช็คเอาต์ออกงาน ${personName} แล้ว`);
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คเอาต์ไม่สำเร็จ');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<LogOut class="h-4.5 w-4.5 text-amber-600" />
				เช็คเอาต์ออกงาน
			</Dialog.Title>
			<Dialog.Description>ตรวจสอบข้อมูลก่อนบันทึกการออกจากกะ</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-1 rounded-xl border border-border bg-muted/40 p-3 text-sm">
			<p class="font-bold break-words text-foreground">{personName}</p>
			{#if volunteer?.volunteer_code}
				<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<IdCard class="h-3.5 w-3.5" />
					รหัสอาสาสมัคร:
					<span class="font-mono font-bold text-foreground">{volunteer.volunteer_code}</span>
				</p>
			{/if}
			<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<CalendarClock class="h-3.5 w-3.5" />
				กะ: <span class="font-bold text-foreground">{shiftLabel}</span>
			</p>
			{#if assignment.check_in_at}
				<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<LogIn class="h-3.5 w-3.5" />
					เช็คอินเมื่อ:
					<span class="font-bold text-foreground"
						>{formatThaiDateTime(assignment.check_in_at)} น.</span
					>
				</p>
			{/if}
		</div>

		<div class="flex justify-end gap-2">
			<Button
				variant="outline"
				disabled={checkOutMutation.isPending}
				onclick={() => (open = false)}
			>
				ยกเลิก
			</Button>
			<Button
				class="gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
				disabled={checkOutMutation.isPending}
				onclick={confirm}
			>
				ยืนยันเช็คเอาต์
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<script lang="ts">
	/**
	 * "เช็คอินแทน / เช็คเอาต์แทน (Manual Override)" dialog — roster tab (Tab 2),
	 * `roster-row.svelte`'s per-row override affordance described by the info
	 * banner in `roster-attendance-tab.svelte` ("กรณีอุปกรณ์ขัดข้อง").
	 *
	 * `check_in` mode is a REAL write: `shiftAssignmentSchema`'s refine requires
	 * a non-empty `check_in_reason` whenever `check_in_method === 'manual_override'`
	 * (CR-094 §3.2 / FR-VOL-11.2), so the reason typed here is persisted via
	 * `useCheckIn`.
	 *
	 * `check_out` mode has no such field — `ShiftAssignmentRepository#checkOut`
	 * (schema.md §2.9) only ever sets `check_out_at`; there is no
	 * `check_out_method`/`check_out_reason` column to write a reason into. So
	 * this mode collects no text and is only a confirmation step before calling
	 * the same `useCheckOut` a 1-click check-out would — flagged here (not
	 * silently faked) as a schema gap for the CR, same convention as the "ลบ"
	 * stub in `volunteer-card.svelte`.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { useCheckIn, useCheckOut } from '../application/queries';

	let {
		open = $bindable(false),
		mode,
		assignmentId,
		volunteerName
	}: {
		open?: boolean;
		mode: 'check_in' | 'check_out';
		assignmentId: string;
		volunteerName: string;
	} = $props();

	const queryClient = useQueryClient();
	const checkInMutation = useCheckIn(queryClient);
	const checkOutMutation = useCheckOut(queryClient);

	let reason = $state('');
	const isPending = $derived(checkInMutation.isPending || checkOutMutation.isPending);

	$effect(() => {
		if (!open) reason = '';
	});

	async function submit() {
		if (mode === 'check_in') {
			if (!reason.trim()) {
				toast.error('กรุณาระบุเหตุผลที่เช็คอินแทน');
				return;
			}
			try {
				await checkInMutation.mutateAsync({
					id: assignmentId,
					method: 'manual_override',
					reason: reason.trim()
				});
				toast.success(`เช็คอินแทน ${volunteerName} แล้ว`);
				open = false;
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'เช็คอินแทนไม่สำเร็จ');
			}
			return;
		}
		try {
			await checkOutMutation.mutateAsync(assignmentId);
			toast.success(`เช็คเอาต์แทน ${volunteerName} แล้ว`);
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เช็คเอาต์แทนไม่สำเร็จ');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Title class="flex items-center gap-2">
			{#if mode === 'check_in'}
				<LogIn class="h-4.5 w-4.5 text-violet-600" />
				เช็คอินแทน (Manual Override)
			{:else}
				<LogOut class="h-4.5 w-4.5 text-violet-600" />
				เช็คเอาต์แทน (Manual Override)
			{/if}
		</Dialog.Title>
		<p class="text-sm text-muted-foreground">
			บันทึกแทน <span class="font-bold text-foreground">{volunteerName}</span> ในกรณีอุปกรณ์สแกนขัดข้อง
			หรือไม่สามารถเช็คอิน/เช็คเอาต์ด้วยตนเองได้
		</p>

		{#if mode === 'check_in'}
			<div class="space-y-1.5">
				<span class="text-xs font-semibold text-foreground">
					เหตุผลที่เช็คอินแทน <span class="text-destructive">*</span>
				</span>
				<Textarea
					bind:value={reason}
					rows={3}
					placeholder="เช่น เครื่องสแกน QR ขัดข้อง, อาสาสมัครลืมโทรศัพท์/บัตรประจำตัว..."
				/>
			</div>
		{:else}
			<div class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
				<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
				<p class="text-xs text-amber-900">
					ระบบยังไม่มีช่องบันทึกเหตุผลสำหรับ "เช็คเอาต์แทน" (มีเฉพาะฝั่งเช็คอิน) —
					การกดยืนยันด้านล่างจะบันทึกเป็นเช็คเอาต์ปกติ ไม่มีหมายเหตุแนบเพิ่ม
				</p>
			</div>
		{/if}

		<div class="flex justify-end gap-2 pt-1">
			<Button variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
			<Button
				class="gap-1.5 bg-violet-600 text-white hover:bg-violet-700"
				disabled={isPending}
				onclick={submit}
			>
				{mode === 'check_in' ? 'ยืนยันเช็คอินแทน' : 'ยืนยันเช็คเอาต์แทน'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

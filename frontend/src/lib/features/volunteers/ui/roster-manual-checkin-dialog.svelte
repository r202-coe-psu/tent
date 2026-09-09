<script lang="ts">
	/**
	 * "เช็คอินแทน / เช็คเอาต์แทน (Manual Override)" dialog — roster tab (Tab 2),
	 * `roster-row.svelte`'s per-row override affordance described by the info
	 * banner in `roster-attendance-tab.svelte` ("กรณีอุปกรณ์ขัดข้อง").
	 *
	 * Both modes are REAL writes: `shiftAssignmentSchema`'s refines require a
	 * non-empty `check_in_reason`/`check_out_reason` whenever
	 * `check_in_method`/`check_out_method === 'manual_override'` (CR-094 §3.2 /
	 * FR-VOL-11.2 for check-in; CR-108 for check-out), so the reason typed here
	 * is persisted via `useCheckIn`/`useCheckOut`.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
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
		if (!reason.trim()) {
			toast.error(
				mode === 'check_in' ? 'กรุณาระบุเหตุผลที่เช็คอินแทน' : 'กรุณาระบุเหตุผลที่เช็คเอาต์แทน'
			);
			return;
		}
		if (mode === 'check_in') {
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
			await checkOutMutation.mutateAsync({
				id: assignmentId,
				method: 'manual_override',
				reason: reason.trim()
			});
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

		<div class="space-y-1.5">
			<span class="text-xs font-semibold text-foreground">
				{mode === 'check_in' ? 'เหตุผลที่เช็คอินแทน' : 'เหตุผลที่เช็คเอาต์แทน'}
				<span class="text-destructive">*</span>
			</span>
			<Textarea
				bind:value={reason}
				rows={3}
				placeholder={mode === 'check_in'
					? 'เช่น เครื่องสแกน QR ขัดข้อง, อาสาสมัครลืมโทรศัพท์/บัตรประจำตัว...'
					: 'เช่น อาสาสมัครลืมสแกนออกก่อนกลับ, เครื่องสแกน QR ขัดข้อง...'}
			/>
		</div>

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

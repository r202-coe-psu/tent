<script lang="ts">
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { useCancelTicket } from '../../application/queries';
	import { formatDistributionError } from '../model/distribution-error';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	interface Props {
		open: boolean;
		ticket: RequisitionTicket;
		shelterCode: string;
		onSuccess?: () => void;
		onClose: () => void;
	}

	let { open = $bindable(false), ticket, shelterCode, onSuccess, onClose }: Props = $props();

	const cancelMutation = useCancelTicket();
	let reason = $state('');

	function resetForm() {
		reason = '';
	}

	$effect(() => {
		if (open) {
			resetForm();
		}
	});

	const canSubmit = $derived(reason.trim().length > 0 && !cancelMutation.isPending);

	async function handleSubmit() {
		const trimmed = reason.trim();
		if (!trimmed) {
			toast.error('กรุณาระบุเหตุผลในการยกเลิกตั๋ว');
			return;
		}

		try {
			await cancelMutation.mutateAsync({
				ticketId: ticket._id,
				reason: trimmed,
				shelterCode
			});

			toast.success(`ยกเลิกใบเบิกจ่าย ${ticket.ticket_no} เรียบร้อยแล้ว`);
			open = false;
			onSuccess?.();
		} catch (err) {
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการยกเลิกตั๋ว กรุณาลองใหม่อีกครั้ง'
			);
			toast.error(msg);
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) {
			resetForm();
			onClose();
		}
	}}
>
	<Dialog.Content class="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-[540px]">
		<!-- Header -->
		<div class="border-b border-red-100 bg-red-50/50 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-red-950">
					<AlertTriangle class="h-5 w-5 text-red-600" />
					<span>ยืนยันการยกเลิกใบเบิกจ่าย</span>
				</Dialog.Title>
				<Dialog.Description class="text-xs text-red-800/80">
					การยกเลิกตั๋วเป็นแบบถาวร ตั๋วจะไม่สามารถนำมาจัดสรรหรือปล่อยของได้อีก
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<!-- Body -->
		<div class="flex-1 space-y-4 overflow-y-auto p-6">
			<!-- Ticket Summary Card -->
			<div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-700">
				<div class="flex items-center justify-between">
					<span class="text-slate-500">เลขที่ตั๋ว:</span>
					<span class="font-mono font-bold text-slate-900">{ticket.ticket_no}</span>
				</div>
				<div class="mt-1.5 flex items-center justify-between">
					<span class="text-slate-500">จุดหมายปลายทาง:</span>
					<span class="font-medium text-slate-800">{ticket.destination_location}</span>
				</div>
				<div class="mt-1.5 flex items-center justify-between">
					<span class="text-slate-500">จำนวนรายการ:</span>
					<span class="font-medium text-slate-800">{ticket.items.length} รายการ</span>
				</div>
			</div>

			<!-- Cancellation Reason Input -->
			<div class="space-y-1.5">
				<label for="cancel-reason" class="text-sm font-semibold text-slate-800">
					เหตุผลในการยกเลิก <span class="text-red-600">*</span>
				</label>
				<Textarea
					id="cancel-reason"
					bind:value={reason}
					rows={3}
					placeholder="เช่น ผู้ขอแจ้งยกเลิกความต้องการ, สินค้าไม่เพียงพอ, สร้างตั๋วซ้ำซ้อน"
					class="w-full text-sm shadow-2xs placeholder:text-slate-400"
				/>
				<p class="text-2xs text-slate-500">
					เหตุผลนี้จะถูกบันทึกในประวัติตั๋วเพื่อใช้ในการตรวจสอบย้อนหลัง
				</p>
			</div>
		</div>

		<!-- Footer Actions -->
		<div
			class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/75 px-6 py-4"
		>
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					open = false;
					onClose();
				}}
				class="text-xs font-semibold"
			>
				ย้อนกลับ
			</Button>

			<Button
				type="button"
				variant="destructive"
				onclick={handleSubmit}
				disabled={!canSubmit}
				class="bg-destructive text-xs font-semibold text-white hover:bg-destructive/90"
			>
				{#if cancelMutation.isPending}
					<Loader2 class="h-4 w-4 animate-spin" />
					<span>กำลังยกเลิก...</span>
				{:else}
					<span>ยืนยันยกเลิกตั๋ว</span>
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

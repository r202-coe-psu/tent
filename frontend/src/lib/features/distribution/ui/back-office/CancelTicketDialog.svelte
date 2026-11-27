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
		<div class="flex items-start gap-3 border-b border-slate-200 px-6 pt-6 pb-5">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600"
			>
				<AlertTriangle class="h-5 w-5" aria-hidden="true" />
			</div>
			<Dialog.Header class="space-y-1 pr-6 text-left">
				<Dialog.Title class="text-lg font-bold text-slate-900">
					ยืนยันการยกเลิกใบเบิกจ่าย
				</Dialog.Title>
				<Dialog.Description class="text-sm text-slate-600">
					การยกเลิกเป็นแบบถาวร ตั๋วจะนำไปจัดสรรหรือปล่อยของไม่ได้อีก
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<!-- Body -->
		<div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
			<!-- Ticket Summary -->
			<dl
				class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
			>
				<dt class="text-slate-500">เลขที่ตั๋ว</dt>
				<dd class="text-right font-mono font-semibold break-all text-slate-900">
					{ticket.ticket_no}
				</dd>
				<dt class="text-slate-500">จุดหมายปลายทาง</dt>
				<dd class="text-right font-medium text-slate-800">{ticket.destination_location}</dd>
				<dt class="text-slate-500">จำนวนรายการ</dt>
				<dd class="text-right font-medium text-slate-800">{ticket.items.length} รายการ</dd>
			</dl>

			<!-- Cancellation Reason Input -->
			<div class="space-y-2">
				<label for="cancel-reason" class="block text-sm font-semibold text-slate-800">
					เหตุผลในการยกเลิก <span class="text-red-600">*</span>
				</label>
				<Textarea
					id="cancel-reason"
					bind:value={reason}
					rows={3}
					placeholder="เช่น ผู้ขอแจ้งยกเลิกความต้องการ, สินค้าไม่เพียงพอ, สร้างตั๋วซ้ำซ้อน"
					class="w-full rounded-lg text-sm shadow-2xs placeholder:text-slate-400"
				/>
				<p class="text-xs text-slate-500">
					เหตุผลนี้จะถูกบันทึกในประวัติตั๋วเพื่อใช้ตรวจสอบย้อนหลัง
				</p>
			</div>
		</div>

		<!-- Footer Actions -->
		<div
			class="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end"
		>
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					open = false;
					onClose();
				}}
				class="min-h-11 text-sm font-semibold sm:min-h-10"
			>
				กลับ
			</Button>

			<Button
				type="button"
				variant="destructive"
				onclick={handleSubmit}
				disabled={!canSubmit}
				class="min-h-11 bg-destructive text-sm font-semibold text-white hover:bg-destructive/90 sm:min-h-10"
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

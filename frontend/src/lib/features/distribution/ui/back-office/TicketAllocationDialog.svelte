<script lang="ts">
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { useAllocateTicketItems } from '../../application/queries';
	import { getReturnableBadgeLabel, getReturnableBadgeClass } from '../model/catalog-eligibility';
	import { validatePositiveQuantity, buildAllocationItem } from '../model/ticket-quantity';
	import { formatDistributionError } from '../model/distribution-error';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Check from '@lucide/svelte/icons/check';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';

	interface Props {
		open: boolean;
		ticket: RequisitionTicket;
		shelterCode: string;
		onSuccess?: () => void;
		onClose: () => void;
	}

	let { open = $bindable(false), ticket, shelterCode, onSuccess, onClose }: Props = $props();

	const allocateMutation = useAllocateTicketItems();

	// Form quantities state keyed by item_id
	let formQuantities = $state<Record<string, string>>({});

	// Initialize or reset form quantities from ticket items
	function initForm() {
		const initial: Record<string, string> = {};
		for (const item of ticket.items) {
			// Prefer existing allocated_qty; fallback to requested_qty if none allocated yet
			initial[item.item_id] = item.allocated_qty ?? item.requested_qty ?? '';
		}
		formQuantities = initial;
	}

	$effect(() => {
		if (open && ticket) {
			initForm();
		}
	});

	// Prefill all items to match requested_qty
	function handleMatchRequested() {
		const matched: Record<string, string> = {};
		for (const item of ticket.items) {
			matched[item.item_id] = item.requested_qty;
		}
		formQuantities = matched;
	}

	// Validate whether all fields have valid positive whole quantities
	const isValid = $derived.by(() => {
		if (!ticket.items || ticket.items.length === 0) return false;
		for (const item of ticket.items) {
			const raw = formQuantities[item.item_id];
			if (!raw) return false;
			if (!validatePositiveQuantity(raw).isValid) return false;
		}
		return true;
	});

	function handleAllocationBlur(itemId: string) {
		const raw = formQuantities[itemId];
		if (!raw) return;
		validatePositiveQuantity(raw);
	}

	async function handleSubmit() {
		for (const item of ticket.items) {
			const raw = formQuantities[item.item_id] ?? '';
			const validation = validatePositiveQuantity(raw);
			if (!validation.isValid) {
				toast.error(validation.error ?? 'จำนวนต้องเป็นจำนวนเต็มที่ถูกต้องสำหรับทุกรายการ');
				return;
			}
		}

		const allocations = ticket.items.map((item) =>
			buildAllocationItem(item, formQuantities[item.item_id] ?? '')
		);

		try {
			await allocateMutation.mutateAsync({
				ticketId: ticket._id,
				allocations,
				shelterCode
			});

			toast.success(`จัดสรรยอดสินค้าสำหรับตั๋ว ${ticket.ticket_no} สำเร็จ`);
			open = false;
			onSuccess?.();
		} catch (err) {
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการจัดสรรยอดสินค้า กรุณาลองใหม่อีกครั้ง'
			);
			toast.error(msg);
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) {
			initForm();
			onClose();
		}
	}}
>
	<Dialog.Content class="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-[700px]">
		<!-- Header -->
		<div class="border-b border-slate-200/80 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-slate-900">
					<Boxes class="h-5 w-5 text-[#0A2647]" />
					<span>จัดสรรยอดสินค้า</span>
				</Dialog.Title>
				<Dialog.Description class="text-xs text-slate-500">
					บันทึกจำนวนที่คลังจัดเตรียมจริงสำหรับใบเบิกจ่าย <strong class="font-mono text-slate-700"
						>{ticket.ticket_no}</strong
					>
					(การจัดสรรยอดนี้ยังไม่มีการตัดสต็อกจริงในคลัง)
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<!-- Body: Items List -->
		<div class="flex-1 space-y-4 overflow-y-auto p-6">
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-slate-700">
					รายการสินค้าในตั๋ว ({ticket.items.length} รายการ)
				</span>
				<Button
					type="button"
					variant="link"
					onclick={handleMatchRequested}
					class="h-auto p-0 text-xs font-semibold"
				>
					<Check class="h-3.5 w-3.5" />
					<span>จัดสรรตามยอดขอทั้งหมด</span>
				</Button>
			</div>

			<div class="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-2xs">
				<table class="w-full min-w-[460px] text-left text-sm">
					<thead
						class="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold tracking-wider text-slate-600 uppercase"
					>
						<tr>
							<th scope="col" class="py-2.5 pr-2 pl-4">ชื่อรายการ</th>
							<th scope="col" class="px-2 py-2.5 text-center">ประเภท</th>
							<th scope="col" class="px-2 py-2.5 text-right">ยอดที่ขอ</th>
							<th scope="col" class="py-2.5 pr-4 pl-2 text-right">ยอดจัดสรรจริง *</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each ticket.items as item (item.item_id)}
							<tr class="hover:bg-slate-50/50">
								<td class="py-3 pr-2 pl-4">
									<div class="font-bold text-slate-900">{item.item_name}</div>
									<div class="font-mono text-2xs text-slate-400">ID: {item.item_id}</div>
								</td>
								<td class="px-2 py-3 text-center">
									<span
										class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {getReturnableBadgeClass(
											item.returnable
										)}"
									>
										{getReturnableBadgeLabel(item.returnable)}
									</span>
								</td>
								<td class="px-2 py-3 text-right text-xs font-semibold text-slate-600 tabular-nums">
									{item.requested_qty}
								</td>
								<td class="py-3 pr-4 pl-2 text-right">
									<div class="inline-flex flex-col items-end gap-1">
										<Input
											type="text"
											inputmode="numeric"
											step="1"
											min="1"
											bind:value={formQuantities[item.item_id]}
											onblur={() => {
												handleAllocationBlur(item.item_id);
											}}
											aria-label="ยอดจัดสรร {item.item_name}"
											class="h-9 w-24 text-right text-xs font-bold tabular-nums shadow-2xs {!formQuantities[
												item.item_id
											] || validatePositiveQuantity(formQuantities[item.item_id]).isValid
												? ''
												: 'border-red-400 focus:ring-red-400'}"
										/>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div
				class="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
			>
				<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
				<span>
					เมื่อจัดสรรยอดเสร็จแล้ว ตั๋วจะยังคงอยู่ในสถานะ "รอจัดของ"
					จนกว่าผู้จัดการจะทำการอนุมัติเพื่อเปลี่ยนสถานะเป็น "พร้อมส่งออก"
				</span>
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
				ยกเลิก
			</Button>

			<Button
				type="button"
				variant="default"
				onclick={handleSubmit}
				disabled={!isValid || allocateMutation.isPending}
				class="text-xs font-semibold hover:bg-primary-dark"
			>
				{#if allocateMutation.isPending}
					<Loader2 class="h-4 w-4 animate-spin" />
					<span>กำลังบันทึกยอด...</span>
				{:else}
					<span>บันทึกการจัดสรร</span>
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<script lang="ts">
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { useDispatchTicket } from '../../application/queries';
	import { formatDistributionError } from '../model/distribution-error';
	import PhysicalLotPicker from './PhysicalLotPicker.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import Truck from '@lucide/svelte/icons/truck';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import User from '@lucide/svelte/icons/user';
	import MapPin from '@lucide/svelte/icons/map-pin';

	interface Props {
		open: boolean;
		ticket: RequisitionTicket;
		shelterCode: string;
		onSuccess?: () => void;
		onClose: () => void;
	}

	let { open = $bindable(false), ticket, shelterCode, onSuccess, onClose }: Props = $props();

	const dispatchMutation = useDispatchTicket();

	// Local form state
	let driverName = $state('');
	let licensePlate = $state('');
	let selectedLots = $state<Record<string, string>>({});

	function resetForm() {
		driverName = '';
		licensePlate = '';
		selectedLots = {};
	}

	$effect(() => {
		if (open) {
			resetForm();
		}
	});

	// Check if every item on the ticket has an assigned physical lot
	const areAllLotsSelected = $derived.by(() => {
		if (!ticket.items || ticket.items.length === 0) return false;
		for (const item of ticket.items) {
			const lotRef = selectedLots[item.item_id];
			if (!lotRef || !lotRef.startsWith('stock_ledger:')) {
				return false;
			}
		}
		return true;
	});

	const isSubmitting = $derived(dispatchMutation.isPending);
	const canSubmit = $derived(
		areAllLotsSelected && !isSubmitting && ticket.status === 'READY_FOR_DISPATCH'
	);

	async function handleDispatchSubmit() {
		if (!areAllLotsSelected) {
			toast.error('กรุณาเลือก Physical Lot ให้ครบทุกรายการก่อนปล่อยรถ');
			return;
		}

		try {
			await dispatchMutation.mutateAsync({
				ticketId: ticket._id,
				options: {
					driver_name: driverName.trim() || undefined,
					license_plate: licensePlate.trim() || undefined,
					item_lots: selectedLots
				},
				shelterCode
			});

			toast.success(
				`ปล่อยรถใบเบิกจ่าย ${ticket.ticket_no} ออกจากคลังสินค้าเรียบร้อยแล้ว (สถานะ: กำลังนำส่ง)`
			);
			open = false;
			onSuccess?.();
		} catch (err) {
			const msg = formatDistributionError(err, 'เกิดข้อผิดพลาดในการปล่อยรถ กรุณาลองใหม่อีกครั้ง');
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
	<Dialog.Content
		class="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-[650px] lg:max-w-[750px]"
	>
		<!-- Header -->
		<div class="border-b border-slate-200/80 bg-white px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-slate-900">
					<Truck class="h-5 w-5 text-[#0A2647]" />
					<span>เลือก Physical Lot และปล่อยรถ</span>
				</Dialog.Title>
				<Dialog.Description class="text-xs text-slate-500">
					บันทึกการตัดสต็อกสินค้าจริงตาม Physical Lot (FEFO) และปล่อยสินค้าเดินทางไปยังจุดแจกจ่าย
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<!-- Scrollable Body -->
		<div class="flex-1 space-y-6 overflow-y-auto bg-slate-50/40 p-6">
			<!-- Summary Info Card -->
			<div
				class="rounded-xl border border-slate-200/80 bg-white p-4 text-xs text-slate-700 shadow-2xs"
			>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					<div>
						<span class="text-slate-400">เลขที่ตั๋ว:</span>
						<strong class="ml-1 font-mono text-slate-900">{ticket.ticket_no}</strong>
					</div>
					<div class="flex items-center gap-1">
						<MapPin class="h-3.5 w-3.5 text-slate-400" />
						<span class="text-slate-400">จุดหมายปลายทาง:</span>
						<strong class="text-slate-900">{ticket.destination_location}</strong>
					</div>
				</div>
			</div>

			<!-- Physical Lot Selection for each line item -->
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<h4 class="text-sm font-bold text-slate-900">
						รายการสินค้าและ Lot ที่ต้องปล่อย ({ticket.items.length} รายการ)
					</h4>
					<span class="text-2xs font-semibold text-slate-500">
						เลือกแล้ว {Object.keys(selectedLots).length} จาก {ticket.items.length} รายการ
					</span>
				</div>

				<div class="space-y-4">
					{#each ticket.items as item (item.item_id)}
						<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
							<PhysicalLotPicker
								itemId={item.item_id}
								itemName={item.item_name}
								allocatedQty={item.allocated_qty}
								selectedLotRef={selectedLots[item.item_id] ?? ''}
								onSelect={(lotRef) => {
									selectedLots = {
										...selectedLots,
										[item.item_id]: lotRef
									};
								}}
								disabled={isSubmitting}
							/>
						</div>
					{/each}
				</div>
			</div>

			<!-- Logistics / Driver Metadata (Optional) -->
			<div class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
				<h4 class="text-xs font-bold text-slate-900">ข้อมูลการขนส่ง (ถ้ามี)</h4>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div>
						<label for="driver-name" class="block text-2xs font-semibold text-slate-600"
							>ชื่อคนขับ / ผู้ขนส่ง</label
						>
						<div class="relative mt-1">
							<User class="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-slate-400" />
							<Input
								id="driver-name"
								type="text"
								bind:value={driverName}
								placeholder="ระบุชื่อคนขับ (ถ้ามี)"
								disabled={isSubmitting}
								class="h-9 w-full rounded-lg pr-3 pl-8 text-xs placeholder:text-slate-400"
							/>
						</div>
					</div>

					<div>
						<label for="license-plate" class="block text-2xs font-semibold text-slate-600"
							>ทะเบียนรถ / ยานพาหนะ</label
						>
						<div class="relative mt-1">
							<Truck class="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-slate-400" />
							<Input
								id="license-plate"
								type="text"
								bind:value={licensePlate}
								placeholder="ระบุทะเบียนรถ (ถ้ามี)"
								disabled={isSubmitting}
								class="h-9 w-full rounded-lg pr-3 pl-8 text-xs placeholder:text-slate-400"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Footer Actions -->
		<div
			class="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4"
		>
			<button
				type="button"
				disabled={isSubmitting}
				onclick={() => {
					resetForm();
					open = false;
					onClose();
				}}
				class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
			>
				ยกเลิก
			</button>

			<button
				type="button"
				disabled={!canSubmit}
				onclick={handleDispatchSubmit}
				class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0A2647] px-5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#051930] disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if isSubmitting}
					<Loader2 class="h-4 w-4 animate-spin" />
					<span>กำลังบันทึกการปล่อยของ...</span>
				{:else}
					<Truck class="h-4 w-4" />
					<span>ยืนยันปล่อยรถ</span>
				{/if}
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<script lang="ts">
	import { getDistributionStore } from '../application/item-distribution-store.svelte';
	import type { RequisitionItem } from '../domain/item-distribution';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { toast } from 'svelte-sonner';

	const store = getDistributionStore();

	let selectedItemId = $state('');
	let returnQty = $state(1);
	let damagedQty = $state(0);

	$effect(() => {
		if (store.selectedTicket && store.selectedTicket.items.length > 0) {
			selectedItemId = store.selectedTicket.items[0].item_id;
		}
	});

	function handleReturn(e: SubmitEvent) {
		e.preventDefault();
		const ticket = store.selectedTicket;
		if (!ticket || !selectedItemId) return;

		const targetItem = ticket.items.find((i) => i.item_id === selectedItemId);
		if (!targetItem) return;

		const pendingToReturn =
			targetItem.distributed_qty - (targetItem.returned_qty + targetItem.damaged_qty);
		const totalEntered = returnQty + damagedQty;

		if (totalEntered <= 0) {
			toast.error('กรุณาระบุจำนวนที่ส่งคืน หรือ ชำรุด/สูญหาย');
			return;
		}

		if (totalEntered > pendingToReturn) {
			toast.error(
				`จำนวนที่ระบุเกินยอดที่ยังไม่ได้ส่งคืน (คงค้างคืน: ${pendingToReturn} ${targetItem.unit})`
			);
			return;
		}

		store.returnBorrowedItem(ticket.ticket_code, selectedItemId, returnQty, damagedQty);

		toast.success(`บันทึกการส่งคืนพัสดุสำหรับ ${ticket.ticket_code} สำเร็จ!`);
	}
</script>

{#if store.selectedTicket}
	{@const ticket = store.selectedTicket}
	<Dialog.Root
		open={store.returnModalOpen}
		onOpenChange={(open) => {
			if (!open) store.closeReturnModal();
		}}
	>
		<Dialog.Content class="p-0 sm:max-w-lg">
			<Dialog.Header class="border-b p-6 pr-10 pb-4">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-100 bg-amber-50 text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400"
					>
						<RotateCcw class="size-5" />
					</div>
					<div class="min-w-0">
						<Dialog.Title class="text-lg font-bold">บันทึกการรับคืนพัสดุยืม</Dialog.Title>
						<Dialog.Description class="text-xs">
							รายการ Ticket: <span class="font-mono font-bold text-slate-700 dark:text-slate-300"
								>{ticket.ticket_code}</span
							>
						</Dialog.Description>
					</div>
				</div>
			</Dialog.Header>

			<!-- Form Body -->
			<form onsubmit={handleReturn} class="space-y-5 px-6 pb-6">
				<!-- Item Picker -->
				<div class="space-y-2">
					<Label
						class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
					>
						เลือกรายการสินค้าที่ส่งคืน <span class="text-rose-500">*</span>
					</Label>
					<Select.Root type="single" bind:value={selectedItemId}>
						<Select.Trigger class="w-full">
							{@const item = ticket.items.find(
								(i: RequisitionItem) => i.item_id === selectedItemId
							)}
							<span class="min-w-0 truncate">
								{item
									? `${item.name} (เบิก ${item.distributed_qty} - คืนแล้ว ${item.returned_qty} - ชำรุด ${item.damaged_qty} ${item.unit})`
									: 'เลือกสินค้า'}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each ticket.items as item (item.item_id)}
								<Select.Item
									value={item.item_id}
									label="{item.name} (เบิก {item.distributed_qty} - คืนแล้ว {item.returned_qty} - ชำรุด {item.damaged_qty} {item.unit})"
								>
									{item.name} (เบิก {item.distributed_qty} - คืนแล้ว {item.returned_qty} - ชำรุด {item.damaged_qty}
									{item.unit})
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<!-- Quantity Returned -->
					<div class="space-y-2">
						<Label
							for="qty-return"
							class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
						>
							จำนวนที่ส่งคืนสมบูรณ์
						</Label>
						<Input
							id="qty-return"
							type="number"
							min="0"
							bind:value={returnQty}
							class="text-base font-bold"
						/>
					</div>

					<!-- Quantity Damaged / Lost -->
					<div class="space-y-2">
						<Label
							for="qty-damaged"
							class="block text-xs font-semibold tracking-wider text-rose-700 uppercase dark:text-rose-400"
						>
							จำนวนชำรุด / สูญหาย
						</Label>
						<Input
							id="qty-damaged"
							type="number"
							min="0"
							bind:value={damagedQty}
							class="border-rose-200 text-base font-bold text-rose-600 focus-visible:ring-rose-500 dark:border-rose-900/50 dark:text-rose-400"
						/>
					</div>
				</div>

				<div
					class="flex items-start gap-2 rounded-xl border border-amber-200/60 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300"
				>
					<AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-600" />
					<p>
						กรณีพัสดุชำรุดหรือสูญหาย
						ระบบจะบันทึกสถานะพัสดุเพื่อประเมินความเสียหายและตัดจำหน่ายออกจากคลังหลัก
					</p>
				</div>

				<Dialog.Footer class="-mx-6 -mb-6 rounded-b-xl border-t p-4">
					<Button type="button" variant="ghost" onclick={() => store.closeReturnModal()}>
						ยกเลิก
					</Button>
					<Button
						type="submit"
						class="gap-2 bg-amber-400 font-bold text-slate-900 shadow-xs hover:bg-amber-300 dark:bg-amber-500 dark:text-slate-950"
					>
						<RotateCcw class="size-4" />
						<span>ยืนยันบันทึกการส่งคืน</span>
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>
{/if}

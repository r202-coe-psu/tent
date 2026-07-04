<script lang="ts">
	import { useIncomingTransfers, useReceiveTransfer } from '../application/queries';
	import { useSupplyItems } from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SHELTER_CODE } from '../data/operations.pouch';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import Truck from '@lucide/svelte/icons/truck';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Clock from '@lucide/svelte/icons/clock';

	const transfersQuery = useIncomingTransfers();
	const itemsQuery = useSupplyItems();
	const receiveMutation = useReceiveTransfer();

	// Local state to hold the editable quantities for each transfer
	// transfer_id -> item_id -> received_qty
	let receivedQuantities = $state<Record<string, Record<string, number>>>({});

	// Initialize state when transfers load
	$effect(() => {
		if (transfersQuery.data) {
			const newQtys: Record<string, Record<string, number>> = {};
			for (const transfer of transfersQuery.data) {
				newQtys[transfer._id] = {};
				for (const item of transfer.items) {
					// Default to full receipt, but allow editing
					// Only set if not already set by user
					if (receivedQuantities[transfer._id]?.[item.item_id] === undefined) {
						newQtys[transfer._id][item.item_id] = item.qty;
					} else {
						newQtys[transfer._id][item.item_id] = receivedQuantities[transfer._id][item.item_id];
					}
				}
			}
			receivedQuantities = newQtys;
		}
	});

	function getItemName(itemId: string) {
		return itemsQuery.data?.find((i) => i._id === itemId)?.name ?? itemId;
	}

	async function handleReceive(transfer: any) {
		const qtys = receivedQuantities[transfer._id];
		if (!qtys) return;

		const receivedItems = transfer.items.map((item: any) => ({
			item_id: item.item_id,
			qty: qtys[item.item_id] ?? 0
		}));

		const ctx = {
			shelterCode: SHELTER_CODE,
			createdBy: authStore.user?.name ?? 'unknown'
		};

		toast.promise(receiveMutation.mutateAsync({ transfer, receivedItems, ctx }), {
			loading: 'กำลังบันทึกรับของเข้าคลัง...',
			success: 'รับพัสดุสำเร็จ!',
			error: (err) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการรับของ')
		});
	}
</script>

<div class="space-y-6">
	{#if transfersQuery.isLoading || itemsQuery.isLoading}
		<div class="flex items-center justify-center p-12">
			<div class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
		</div>
	{:else if transfersQuery.error}
		<div class="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center text-destructive">
			<p class="font-bold">ไม่สามารถดึงข้อมูลรายการรับเข้าได้</p>
		</div>
	{:else if !transfersQuery.data || transfersQuery.data.length === 0}
		<div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/20 p-12 text-center">
			<Truck class="mb-3 h-12 w-12 text-muted-foreground/50" />
			<h3 class="text-lg font-bold text-foreground">ไม่มีพัสดุรอรับเข้า</h3>
			<p class="text-sm text-muted-foreground mt-1">
				ขณะนี้ไม่มีรายการพัสดุที่ถูกจัดส่งมายังศูนย์นี้
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-6">
			{#each transfersQuery.data as transfer (transfer._id)}
				<div class="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm transition-all hover:shadow-md">
					<!-- Header -->
					<div class="border-b border-border/60 bg-muted/20 p-4 sm:px-6">
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div class="flex items-center gap-3">
								<div class="rounded-xl bg-primary/10 p-2 text-primary">
									<Truck class="h-5 w-5" />
								</div>
								<div>
									<h4 class="text-sm font-bold text-foreground">จาก: {transfer.from_shelter}</h4>
									<div class="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
										<Clock class="h-3.5 w-3.5" />
										ส่งเมื่อ: {new Date(transfer.timeline.shipped?.at ?? '').toLocaleString('th-TH')}
									</div>
								</div>
							</div>
							{#if transfer.notes}
								<div class="rounded-lg bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border/50">
									หมายเหตุ: {transfer.notes}
								</div>
							{/if}
						</div>
					</div>

					<!-- Items List with Editable Quantities -->
					<div class="p-4 sm:p-6">
						<h5 class="mb-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">รายการพัสดุ (ตรวจสอบและแก้ไขจำนวนรับจริงได้)</h5>
						<div class="space-y-3">
							{#each transfer.items as item}
								<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/50 bg-background p-3">
									<div class="flex-1">
										<p class="text-sm font-bold text-foreground">{getItemName(item.item_id)}</p>
										<p class="text-xs font-medium text-muted-foreground mt-0.5">
											ต้นทางระบุว่าส่งมา: <span class="font-bold text-primary">{item.qty} {item.unit}</span>
										</p>
									</div>
									<div class="flex items-center gap-2">
										<span class="text-xs font-bold text-muted-foreground">รับจริง:</span>
										<Input
											type="number"
											min="0"
											step="any"
											bind:value={receivedQuantities[transfer._id][item.item_id]}
											class="h-9 w-24 rounded-lg text-center font-bold"
										/>
										<span class="text-xs font-bold text-foreground w-8">{item.unit}</span>
									</div>
								</div>
							{/each}
						</div>
					</div>

					<!-- Footer Actions -->
					<div class="bg-muted/10 p-4 sm:px-6 border-t border-border/50 flex justify-end">
						<Button
							onclick={() => handleReceive(transfer)}
							disabled={receiveMutation.isPending}
							class="gap-2 rounded-xl font-bold px-6 shadow-sm"
						>
							<PackageCheck class="h-4.5 w-4.5" />
							ยืนยันรับเข้าคลัง (Receive)
						</Button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<script lang="ts">
	import { getDistributionStore } from '../application/item-distribution-store.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import Send from '@lucide/svelte/icons/send';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Check from '@lucide/svelte/icons/check';
	import { toast } from 'svelte-sonner';

	const store = getDistributionStore();

	let selectedRecipientId = $state(store.recipients[0]?.id || '');
	let qtyToDistribute = $state(1);
	let simulatedScanSuccess = $state(false);

	function handleDistribute(e: SubmitEvent) {
		e.preventDefault();
		const stockItem = store.selectedStockItem;
		if (!stockItem) return;

		if (qtyToDistribute <= 0 || qtyToDistribute > stockItem.availableQuantity) {
			toast.error(`กรุณาระบุจำนวนระหว่าง 1 ถึง ${stockItem.availableQuantity}`);
			return;
		}

		store.distributeItemToRecipient(stockItem.id, selectedRecipientId, qtyToDistribute);

		toast.success(
			`แจกจ่าย ${stockItem.name} จำนวน ${qtyToDistribute} ${stockItem.unit} เรียบร้อยแล้ว!`
		);
	}

	function handleScanSimulate() {
		simulatedScanSuccess = true;
		const randomRecipient = store.recipients[Math.floor(Math.random() * store.recipients.length)];
		selectedRecipientId = randomRecipient.id;
		toast.info(`สแกน QR Code สำเร็จ: พบข้อมูล ${randomRecipient.name}`);
		setTimeout(() => {
			simulatedScanSuccess = false;
		}, 2000);
	}
</script>

{#if store.selectedStockItem}
	{@const item = store.selectedStockItem}
	<Dialog.Root
		open={store.distributeModalOpen}
		onOpenChange={(open) => {
			if (!open) store.closeDistributeModal();
		}}
	>
		<Dialog.Content class="p-0 sm:max-w-lg">
			<Dialog.Header class="border-b p-6 pr-10 pb-4">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-400"
					>
						<Send class="size-5" />
					</div>
					<div class="min-w-0">
						<Dialog.Title class="text-lg font-bold">บันทึกการแจกจ่ายสิ่งของหน้างาน</Dialog.Title>
						<Dialog.Description class="text-xs">
							แจกจ่ายพัสดุจากคลังหน้างานไปยังผู้พักพิงหรืออาสาสมัคร
						</Dialog.Description>
					</div>
				</div>
			</Dialog.Header>

			<!-- Form Body -->
			<form onsubmit={handleDistribute} class="space-y-5 px-6 pb-6">
				<!-- Item Card Summary -->
				<div
					class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"
				>
					<div>
						<span class="block text-[11px] font-semibold tracking-wider text-slate-500 uppercase"
							>รายการพัสดุ</span
						>
						<h4 class="font-bold text-slate-900 dark:text-slate-100">{item.name}</h4>
						<p class="text-xs text-slate-500">ที่ตั้ง: {item.location}</p>
					</div>
					<div class="text-right">
						<span class="block text-[11px] font-semibold tracking-wider text-slate-500 uppercase"
							>คงเหลือพร้อมแจก</span
						>
						<span class="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
							{item.availableQuantity}
							{item.unit}
						</span>
					</div>
				</div>

				<!-- Recipient Selection / QR Scan Simulation -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<Label
							class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
						>
							ผู้รับพัสดุ / เจ้าหน้าที่ <span class="text-rose-500">*</span>
						</Label>
						<Button
							type="button"
							variant="link"
							size="sm"
							onclick={handleScanSimulate}
							class="h-auto gap-1 p-0 text-xs font-semibold text-blue-600 dark:text-blue-400"
						>
							<QrCode class="size-3.5" />
							<span>จำลองสแกน QR Code</span>
						</Button>
					</div>

					<Select.Root type="single" bind:value={selectedRecipientId}>
						<Select.Trigger class="w-full">
							{@const r = store.recipients.find((r) => r.id === selectedRecipientId)}
							<span class="min-w-0 truncate">
								{r
									? `${r.name} (${r.type === 'evacuee' ? `ผู้พักพิง ${r.room || ''}` : `อาสาสมัคร ${r.role || ''}`})`
									: 'เลือกผู้รับพัสดุ'}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each store.recipients as r (r.id)}
								<Select.Item
									value={r.id}
									label="{r.name} ({r.type === 'evacuee'
										? `ผู้พักพิง ${r.room || ''}`
										: `อาสาสมัคร ${r.role || ''}`})"
								>
									{r.name} ({r.type === 'evacuee'
										? `ผู้พักพิง ${r.room || ''}`
										: `อาสาสมัคร ${r.role || ''}`})
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>

					{#if simulatedScanSuccess}
						<div
							class="flex animate-in items-center gap-1.5 rounded-lg bg-emerald-50 p-2 text-xs font-semibold text-emerald-700 fade-in dark:bg-emerald-950/40 dark:text-emerald-300"
						>
							<Check class="size-4 text-emerald-600" />
							<span>สแกนข้อมูลบัตรสำเร็จ</span>
						</div>
					{/if}
				</div>

				<!-- Quantity Input -->
				<div class="space-y-2">
					<Label
						for="qty-distribute"
						class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
					>
						จำนวนที่ต้องการแจกจ่าย ({item.unit}) <span class="text-rose-500">*</span>
					</Label>
					<Input
						id="qty-distribute"
						type="number"
						min="1"
						max={item.availableQuantity}
						bind:value={qtyToDistribute}
						class="text-base font-bold"
					/>
				</div>

				<Dialog.Footer class="border-t pt-4">
					<Button type="button" variant="ghost" onclick={() => store.closeDistributeModal()}>
						ยกเลิก
					</Button>
					<Button type="submit" class="gap-2 bg-blue-600 font-bold hover:bg-blue-500">
						<Send class="size-4" />
						<span>ยืนยันการแจกจ่าย</span>
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>
{/if}

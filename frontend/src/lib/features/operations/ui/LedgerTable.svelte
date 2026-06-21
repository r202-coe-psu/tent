<script lang="ts">
	import { useLedger } from '../application/queries';
	import { useSupplyItems } from '$lib/features/supply';
	import * as Table from '$lib/components/ui/table/index.js';
	import Clock from '@lucide/svelte/icons/clock';
	import ArrowDownLeft from '@lucide/svelte/icons/arrow-down-left';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

	// Fetch stock movements ledger
	const ledgerQuery = useLedger();
	const itemsQuery = useSupplyItems();

	const ledger = $derived(ledgerQuery.data ?? []);
	// Sort by occurred_at descending to show newest entries first
	const sortedLedger = $derived(
		[...ledger].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
	);

	// Maps item_id to name
	const itemMap = $derived(() => {
		const map: Record<string, string> = {};
		for (const item of itemsQuery.data ?? []) {
			map[item._id] = item.name;
		}
		return map;
	});

	// Thai translation for ledger reason
	const REASON_LABELS: Record<string, string> = {
		receive: 'รับเข้าคลัง',
		distribute: 'แจกจ่าย',
		requisition: 'เบิกจ่ายโรงครัว',
		adjust: 'ปรับปรุงคลัง',
		transfer_out: 'โอนย้ายออก',
		transfer_in: 'โอนย้ายเข้า',
		donation: 'รับบริจาค'
	};

	function formatDateTime(isoString: string): string {
		try {
			return (
				new Date(isoString).toLocaleString('th-TH', {
					day: '2-digit',
					month: '2-digit',
					year: '2-digit',
					hour: '2-digit',
					minute: '2-digit'
				}) + ' น.'
			);
		} catch {
			return isoString;
		}
	}
</script>

<div class="space-y-3">
	<div class="flex items-center gap-2">
		<Clock class="h-4 w-4 text-primary" />
		<h3 class="text-base font-bold text-foreground">ประวัติความเคลื่อนไหวคลังสินค้า</h3>
	</div>

	{#if ledgerQuery.isLoading || itemsQuery.isLoading}
		<p class="text-sm text-muted-foreground">กำลังโหลดประวัติคลัง...</p>
	{:else if ledgerQuery.isError}
		<p class="text-sm text-destructive">เกิดข้อผิดพลาด: {ledgerQuery.error?.message}</p>
	{:else if sortedLedger.length === 0}
		<div class="rounded-xl border border-border bg-card p-10 text-center">
			<Clock class="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
			<p class="text-sm font-medium text-muted-foreground">ยังไม่มีรายการเคลื่อนไหวคลังในระบบ</p>
			<p class="mt-1 text-xs text-muted-foreground/60">
				ทำรายการ "รับของเข้าคลัง" เพื่อสร้างความเคลื่อนไหวแรก
			</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-[120px]">วัน-เวลา</Table.Head>
							<Table.Head>รายการสิ่งของ</Table.Head>
							<Table.Head>จำนวน</Table.Head>
							<Table.Head>ประเภท</Table.Head>
							<Table.Head>สถานที่เก็บ / เลขอ้างอิง</Table.Head>
							<Table.Head class="w-[100px]">ผู้บันทึก</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each sortedLedger as entry (entry._id)}
							{@const itemName = itemMap()[entry.item_id] ?? 'ไม่ระบุชื่อสิ่งของ'}
							<Table.Row>
								<!-- DateTime -->
								<Table.Cell class="font-mono text-xs whitespace-nowrap text-muted-foreground">
									{formatDateTime(entry.occurred_at)}
								</Table.Cell>

								<!-- Item Name -->
								<Table.Cell class="font-medium text-foreground">
									{itemName}
								</Table.Cell>

								<!-- Quantity & Signed Color -->
								<Table.Cell class="whitespace-nowrap">
									<span class="flex items-center gap-1">
										{#if entry.qty > 0}
											<ArrowDownLeft class="h-3.5 w-3.5 text-emerald-600" />
											<span class="font-bold text-emerald-600">+{entry.qty}</span>
										{:else}
											<ArrowUpRight class="h-3.5 w-3.5 text-rose-600" />
											<span class="font-bold text-rose-600">{entry.qty}</span>
										{/if}
										<span class="text-xs text-muted-foreground">{entry.unit}</span>
									</span>
								</Table.Cell>

								<!-- Reason -->
								<Table.Cell class="whitespace-nowrap">
									<span
										class="rounded-full px-2.5 py-0.5 text-xs font-medium
										{entry.qty > 0
											? 'border border-emerald-100 bg-emerald-50 text-emerald-700'
											: 'border border-rose-100 bg-rose-50 text-rose-700'}"
									>
										{REASON_LABELS[entry.reason] ?? entry.reason}
									</span>
								</Table.Cell>

								<!-- Reference / Lot / Note -->
								<Table.Cell class="max-w-[200px] truncate text-xs text-muted-foreground">
									<div class="flex flex-col gap-0.5">
										{#if entry.lot?.note}
											<span class="font-medium text-foreground">📍 {entry.lot.note}</span>
										{/if}
										{#if entry.lot?.expiry}
											<span
												>⌛ หมดอายุ: {new Date(entry.lot.expiry).toLocaleDateString('th-TH')}</span
											>
										{/if}
										{#if entry.ref_id}
											<span class="w-fit rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px]"
												>Ref: {entry.ref_id}</span
											>
										{/if}
										{#if !entry.lot?.note && !entry.lot?.expiry && !entry.ref_id}
											<span class="text-muted-foreground/50">-</span>
										{/if}
									</div>
								</Table.Cell>

								<!-- Author -->
								<Table.Cell class="truncate text-xs text-muted-foreground">
									{entry.created_by}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	{/if}
</div>

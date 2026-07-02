<script lang="ts">
	import { useLedger, useLedgerByItem } from '../application/queries';
	import { useSupplyItems } from '$lib/features/supply';
	import * as Table from '$lib/components/ui/table/index.js';
	import Clock from '@lucide/svelte/icons/clock';
	import ArrowDownLeft from '@lucide/svelte/icons/arrow-down-left';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

	let { filterItemId = undefined }: { filterItemId?: string } = $props();

	// Fetch stock movements ledger
	const ledgerQuery = useLedger();
	const itemsQuery = useSupplyItems()
	? useLedgerByItem(() => filterItemId!)
	: useLedger();

	const ledger = $derived(ledgerQuery.data ?? []);
	// Sort by occurred_at descending to show newest entries first
	const sortedLedger = $derived(
		[...ledger]
			.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
	);

	// Maps item_id to name
	const itemMap = $derived.by(() => {
		const map: Record<string, string> = {};
		for (const item of itemsQuery.data ?? []) {
			map[item._id] = item.name;
		}
		return map;
	});

	// Thai translation for ledger reason
	const REASON_LABELS: Record<string, string> = {
		receive: 'รับเข้าคลัง',
		purchase: 'จัดซื้อ',
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

<div class="space-y-4">
	<div class="flex items-center gap-2 border-b border-border/60 pb-3">
		<Clock class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">ประวัติความเคลื่อนไหวคลังสินค้า</h3>
	</div>

	{#if ledgerQuery.isLoading || itemsQuery.isLoading}
		<div class="space-y-2">
			{#each [0, 1, 2] as i (i)}
				<div class="h-12 animate-pulse rounded-xl border border-border bg-muted/20"></div>
			{/each}
		</div>
	{:else if ledgerQuery.isError}
		<p class="text-sm text-destructive font-semibold">เกิดข้อผิดพลาด: {ledgerQuery.error?.message}</p>
	{:else if sortedLedger.length === 0}
		<div class="rounded-2xl border border-border bg-muted/10 p-10 text-center flex flex-col justify-center items-center">
			<Clock class="mb-3 h-10 w-10 text-muted-foreground/30" />
			<p class="text-sm font-medium text-muted-foreground">ยังไม่มีรายการเคลื่อนไหวคลังในระบบ</p>
			<p class="mt-1 text-xs text-muted-foreground/60">
				ทำรายการ "รับของเข้าคลัง" เพื่อสร้างความเคลื่อนไหวแรก
			</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-2xl border border-border/80 bg-background shadow-sm">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header class="bg-muted/40 border-b border-border/60">
						<Table.Row class="hover:bg-transparent">
							<Table.Head class="w-[120px] font-bold text-[11px] uppercase tracking-wider text-foreground">วัน-เวลา</Table.Head>
							<Table.Head class="font-bold text-[11px] uppercase tracking-wider text-foreground">รายการสิ่งของ</Table.Head>
							<Table.Head class="font-bold text-[11px] uppercase tracking-wider text-foreground">จำนวน</Table.Head>
							<Table.Head class="font-bold text-[11px] uppercase tracking-wider text-foreground">ประเภท</Table.Head>
							<Table.Head class="font-bold text-[11px] uppercase tracking-wider text-foreground">สถานที่เก็บ / เลขอ้างอิง</Table.Head>
							<Table.Head class="w-[120px] font-bold text-[11px] uppercase tracking-wider text-foreground">ผู้บันทึก</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body class="divide-y divide-border/40">
						{#each sortedLedger as entry (entry._id)}
							{@const itemName = itemMap[entry.item_id] ?? 'ไม่ระบุชื่อสิ่งของ'}
							<Table.Row class="hover:bg-muted/30 transition-colors">
								<!-- DateTime -->
								<Table.Cell class="font-mono text-xs whitespace-nowrap text-muted-foreground">
									{formatDateTime(entry.occurred_at)}
								</Table.Cell>

								<!-- Item Name -->
								<Table.Cell class="font-semibold text-[13px] text-foreground">
									{itemName}
								</Table.Cell>

								<!-- Quantity & Signed Color -->
								<Table.Cell class="whitespace-nowrap">
									<span class="flex items-center gap-1">
										{#if entry.qty > 0}
											<span class="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-extrabold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">
												<ArrowDownLeft class="h-3.5 w-3.5" />
												+{entry.qty.toLocaleString()}
											</span>
										{:else}
											<span class="inline-flex items-center gap-0.5 rounded bg-rose-500/10 px-1.5 py-0.5 text-xs font-extrabold text-rose-600 dark:text-rose-400 border border-rose-500/20 shadow-sm">
												<ArrowUpRight class="h-3.5 w-3.5" />
												{entry.qty.toLocaleString()}
											</span>
										{/if}
										<span class="text-xs text-muted-foreground font-medium">{entry.unit}</span>
									</span>
								</Table.Cell>

								<!-- Reason -->
								<Table.Cell class="whitespace-nowrap">
									<span
										class="rounded-full px-2.5 py-0.5 text-[11px] font-bold border shadow-sm
										{entry.qty > 0
											? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
											: 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'}"
									>
										{REASON_LABELS[entry.reason] ?? entry.reason}
									</span>
								</Table.Cell>

								<!-- Reference / Lot / Note -->
								<Table.Cell class="max-w-[220px] truncate text-xs text-muted-foreground">
									<div class="flex flex-col gap-1 py-1">
										{#if entry.lot?.note}
											<span class="font-medium text-foreground text-[12px]">📍 {entry.lot.note}</span>
										{/if}
										{#if entry.lot?.expiry}
											<span class="text-[11px] text-muted-foreground/90 font-medium">
												⌛ หมดอายุ: {new Date(entry.lot.expiry).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
											</span>
										{/if}
										{#if entry.ref_id}
											<span class="w-fit rounded border border-border/80 bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
												>Ref: {entry.ref_id}</span
											>
										{/if}
										{#if !entry.lot?.note && !entry.lot?.expiry && !entry.ref_id}
											<span class="text-muted-foreground/40">-</span>
										{/if}
									</div>
								</Table.Cell>

								<!-- Author -->
								<Table.Cell class="truncate text-xs text-muted-foreground font-medium">
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

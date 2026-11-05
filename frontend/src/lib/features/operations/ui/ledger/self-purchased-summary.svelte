<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { defaultSelfPurchasedRange, summarizeSelfPurchased } from '../../domain/self-purchased';
	import type { StockLedger } from '../../domain/operations';

	let {
		ledger,
		itemName,
		unitLabel
	}: {
		ledger: readonly StockLedger[];
		itemName: (itemId: string) => string;
		unitLabel: (unit: string) => string;
	} = $props();

	const initial = defaultSelfPurchasedRange();
	let from = $state(initial.from);
	let to = $state(initial.to);

	// An emptied date box falls back to the month so far instead of matching nothing.
	const summary = $derived(
		summarizeSelfPurchased(ledger, {
			from: from || initial.from,
			to: to || initial.to
		})
	);

	const HEAD_CLASS = 'px-4 py-3 text-sm font-semibold text-slate-600';
</script>

<section
	aria-labelledby="self-purchased-summary-title"
	class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
>
	<div class="flex flex-col gap-2.5 border-b border-slate-200/80 p-3 md:p-4">
		<div>
			<h3 id="self-purchased-summary-title" class="text-base font-bold text-slate-900">
				สรุปยอดซื้อเอง
			</h3>
			<p class="text-xs text-slate-500">
				ยอดที่ศูนย์ซื้อเองในช่วงวันที่เลือก (เวลาประเทศไทย) และที่ยังเหลือจากล็อตซื้อเอง
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2.5">
			<Input
				type="date"
				bind:value={from}
				max={to || undefined}
				aria-label="สรุปซื้อเอง ตั้งแต่วันที่"
				class="min-h-11 rounded-lg border-slate-300 bg-white text-base shadow-2xs md:w-40 md:text-sm"
			/>
			<span class="text-sm text-slate-500" aria-hidden="true">ถึง</span>
			<Input
				type="date"
				bind:value={to}
				min={from || undefined}
				aria-label="สรุปซื้อเอง ถึงวันที่"
				class="min-h-11 rounded-lg border-slate-300 bg-white text-base shadow-2xs md:w-40 md:text-sm"
			/>
		</div>
	</div>

	{#if summary.rows.length === 0}
		<p class="p-6 text-center text-sm text-slate-600">ไม่มียอดซื้อเองในช่วงที่เลือก</p>
	{:else}
		<div class="overflow-x-auto">
			<Table.Root class="text-sm">
				<Table.Header class="bg-slate-50">
					<Table.Row class="hover:bg-transparent">
						<Table.Head scope="col" class={HEAD_CLASS}>สินค้า</Table.Head>
						<Table.Head scope="col" class="{HEAD_CLASS} text-right"
							>รับเข้าที่ซื้อเองในช่วงนี้</Table.Head
						>
						<Table.Head scope="col" class="{HEAD_CLASS} text-right"
							>คงเหลือจากล็อตซื้อเอง</Table.Head
						>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each summary.rows as row (`${row.item_id}|${row.unit}`)}
						<Table.Row class="border-t border-slate-100">
							<Table.Cell class="px-4 py-3 font-semibold text-slate-900">
								{itemName(row.item_id)}
							</Table.Cell>
							<Table.Cell class="px-4 py-3 text-right font-bold whitespace-nowrap tabular-nums">
								{row.receivedQty}
								<span class="font-medium text-slate-500">{unitLabel(row.unit)}</span>
							</Table.Cell>
							<Table.Cell class="px-4 py-3 text-right font-bold whitespace-nowrap tabular-nums">
								{row.onHandQty}
								<span class="font-medium text-slate-500">{unitLabel(row.unit)}</span>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
		{#if summary.brokenItemIds.length > 0}
			<p class="border-t border-slate-200/80 p-3 text-xs text-amber-800" role="note">
				บางสินค้าคำนวณยอดคงเหลือรายล็อตไม่ได้ จึงไม่รวมในคอลัมน์คงเหลือ
			</p>
		{/if}
	{/if}
</section>

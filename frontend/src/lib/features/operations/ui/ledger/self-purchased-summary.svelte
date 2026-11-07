<script lang="ts">
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { DateRangePicker } from '$lib/components/ui/date-picker/index.js';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { defaultSelfPurchasedRange, summarizeSelfPurchased } from '../../domain/self-purchased';
	import type { StockLedger } from '../../domain/operations';
	import { clampPage, pageSlice } from '../stock/stock-view';

	let {
		ledger,
		itemName,
		unitLabel
	}: {
		ledger: readonly StockLedger[];
		itemName: (itemId: string) => string;
		unitLabel: (unit: string) => string;
	} = $props();

	const SUMMARY_PAGE_SIZE = 10;

	const initial = defaultSelfPurchasedRange();
	let from = $state(initial.from);
	let to = $state(initial.to);
	let page = $state(1);

	// An emptied date falls back to the month so far instead of matching nothing.
	const summary = $derived(
		summarizeSelfPurchased(ledger, {
			from: from || initial.from,
			to: to || initial.to
		})
	);
	const currentPage = $derived(clampPage(page, summary.rows.length, SUMMARY_PAGE_SIZE));
	const pageRows = $derived(pageSlice(summary.rows, currentPage, SUMMARY_PAGE_SIZE));
	const rangeStart = $derived(
		summary.rows.length === 0 ? 0 : (currentPage - 1) * SUMMARY_PAGE_SIZE + 1
	);
	const rangeEnd = $derived((currentPage - 1) * SUMMARY_PAGE_SIZE + pageRows.length);

	const HEAD_CLASS = 'px-4 py-3 text-sm font-semibold text-slate-600';
</script>

<Accordion.Root type="single" class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
	<Accordion.Item value="self-purchased-summary" class="border-b-0">
		<Accordion.Trigger class="px-3 py-3 hover:no-underline md:px-4">
			<span class="flex flex-col gap-0.5 text-left">
				<span class="text-base font-bold text-slate-900">สรุปยอดซื้อเอง</span>
				<span class="text-xs font-normal text-slate-500">
					ยอดที่ศูนย์ซื้อเองในช่วงวันที่เลือก (เวลาประเทศไทย) และที่ยังเหลือจากล็อตซื้อเอง
				</span>
			</span>
		</Accordion.Trigger>

		<Accordion.Content class="border-t border-slate-200/80 pb-0">
			<div class="p-3 md:p-4">
				<Field.Field class="max-w-sm">
					<Field.Label for="self-purchased-range">ช่วงวันที่</Field.Label>
					<DateRangePicker
						id="self-purchased-range"
						ariaLabel="ช่วงวันที่สรุปยอดซื้อเอง"
						{from}
						{to}
						class="min-h-11"
						onRangeChange={(next) => {
							from = next.from;
							to = next.to;
							page = 1;
						}}
					/>
				</Field.Field>
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
								<Table.Head scope="col" class="{HEAD_CLASS} text-right">
									คงเหลือจากล็อตซื้อเอง
									<span class="block text-xs font-normal text-slate-500"
										>นับทั้งหมด ไม่ตามช่วงวันที่</span
									>
								</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each pageRows as row (`${row.item_id}|${row.unit}`)}
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
				{#if summary.rows.length > SUMMARY_PAGE_SIZE}
					<div
						class="flex flex-col items-center justify-between gap-2 border-t border-slate-200/80 p-3 sm:flex-row"
					>
						<span class="text-sm text-slate-600">
							แสดง {rangeStart}–{rangeEnd} จาก {summary.rows.length} รายการ
						</span>
						<PaginationControls
							bind:page={() => currentPage, (p) => (page = p)}
							count={summary.rows.length}
							perPage={SUMMARY_PAGE_SIZE}
						/>
					</div>
				{/if}
			{/if}
		</Accordion.Content>
	</Accordion.Item>
</Accordion.Root>

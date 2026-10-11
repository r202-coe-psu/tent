<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Clock from '@lucide/svelte/icons/clock';
	import * as Table from '$lib/components/ui/table/index.js';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { useSupplyItems } from '$lib/features/supply';
	import { useItemMasters, formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useLedger } from '../../application/queries';
	import { useStoragePoints } from '../../application/use-storage-points.svelte';
	import { clampPage, pageSlice } from '../stock/stock-view';
	import DaySummaryCards from './day-summary-cards.svelte';
	import LedgerFilters from './ledger-filters.svelte';
	import LedgerRowView from './ledger-row.svelte';
	import LedgerCard from './ledger-card.svelte';
	import { downloadCsv } from './download-csv';
	import {
		LEDGER_PAGE_SIZE,
		mergeLedgerParams,
		parseLedgerParams,
		resolveDayRange,
		type LedgerUrlState
	} from './ledger-url-state';
	import {
		buildLedgerRows,
		dayHeading,
		filterByRange,
		filterLedger,
		groupByDay,
		ledgerToCsv,
		summarizeRows,
		type LedgerLookup
	} from './ledger-view';

	const ledgerQuery = useLedger();
	const itemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const storagePoints = useStoragePoints(() => getShelterCode());

	// Range / type / search / page live in the URL (`?range=&from=&to=&type=&lreason=&lq=&lpage=`) so a
	// reload or a shared link restores the view. Other params (`tab`, …) are preserved.
	const urlState = $derived(parseLedgerParams(page.url.searchParams));

	function updateUrl(patch: Partial<LedgerUrlState>) {
		// Any filter change goes back to page 1; only an explicit `page` keeps its value.
		const next: LedgerUrlState = { ...urlState, page: 1, ...patch };
		const params = mergeLedgerParams(page.url.searchParams, next);
		const qs = params.toString();
		if (qs === page.url.searchParams.toString()) return;
		void goto(resolve(`/back-office/supply${qs ? `?${qs}` : ''}` as '/back-office/supply'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	const itemNames = $derived.by(() => {
		const names: Record<string, string> = {};
		for (const item of itemsQuery.data ?? []) names[item._id] = item.name;
		for (const item of itemMastersQuery.data ?? []) names[item._id] = item.name;
		return names;
	});

	const lookup = $derived<LedgerLookup>({
		itemName: (id) => itemNames[id] ?? 'ไม่ระบุชื่อสิ่งของ',
		unitLabel: (unit) => formatUnit(unit, unitsQuery.data ?? [], langState.current),
		points: storagePoints.points
	});

	const allRows = $derived(buildLedgerRows(ledgerQuery.data ?? [], lookup));
	const range = $derived(resolveDayRange(urlState));
	// The cards describe the whole range; the type chips and search only narrow the list below.
	const inRange = $derived(filterByRange(allRows, range));
	const cards = $derived(summarizeRows(inRange));
	const filtered = $derived(
		filterLedger(allRows, {
			range,
			type: urlState.type,
			reason: urlState.reason,
			q: urlState.q
		})
	);

	const currentPage = $derived(clampPage(urlState.page, filtered.length, LEDGER_PAGE_SIZE));
	const pageRows = $derived(pageSlice(filtered, currentPage, LEDGER_PAGE_SIZE));
	const groups = $derived(groupByDay(pageRows));
	const rangeStart = $derived(filtered.length === 0 ? 0 : (currentPage - 1) * LEDGER_PAGE_SIZE + 1);
	const rangeEnd = $derived(Math.min(currentPage * LEDGER_PAGE_SIZE, filtered.length));

	const isLoading = $derived(
		ledgerQuery.isLoading || itemsQuery.isLoading || itemMastersQuery.isLoading
	);
	const summaryLabel = $derived(urlState.range === 'today' ? 'สรุปวันนี้' : 'สรุปช่วงที่เลือก');

	function exportCsv() {
		if (filtered.length === 0) {
			toast.error('ไม่มีรายการให้ส่งออก');
			return;
		}
		const span = [range.from, range.to].filter(Boolean).join('_') || 'all';
		downloadCsv(`stock-movements-${span}.csv`, ledgerToCsv(filtered));
		toast.success('ส่งออกรายการแล้ว');
	}

	const HEAD_CLASS = 'px-4 py-3 text-sm font-semibold text-slate-600';
</script>

<div class="space-y-4">
	{#if ledgerQuery.isError}
		<p class="text-sm font-semibold text-destructive" role="alert">
			เกิดข้อผิดพลาด: {ledgerQuery.error?.message}
		</p>
	{:else}
		<DaySummaryCards {cards} label={summaryLabel} />

		<section class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
			<LedgerFilters state={urlState} onchange={updateUrl} onexport={exportCsv} />

			{#if isLoading}
				<div class="space-y-2 p-4" aria-busy="true">
					{#each [0, 1, 2] as i (i)}
						<div class="h-12 animate-pulse rounded-xl bg-slate-100"></div>
					{/each}
				</div>
			{:else if filtered.length === 0}
				<div class="flex flex-col items-center justify-center p-10 text-center">
					<Clock class="mb-3 h-10 w-10 text-slate-300" aria-hidden="true" />
					<p class="text-sm font-medium text-slate-600">
						{allRows.length === 0
							? 'ยังไม่มีรายการเคลื่อนไหวคลังในระบบ'
							: 'ไม่พบรายการตามตัวกรองที่เลือก'}
					</p>
					<p class="mt-1 text-xs text-slate-500">
						{allRows.length === 0
							? 'ทำรายการ "รับเข้า" เพื่อสร้างความเคลื่อนไหวแรก'
							: 'ลองเปลี่ยนช่วงเวลา ประเภท หรือคำค้นหา'}
					</p>
				</div>
			{:else}
				<!-- md+: one table, one <tbody> per day -->
				<div class="hidden overflow-x-auto md:block">
					<Table.Root class="text-sm">
						<Table.Header class="bg-slate-50">
							<Table.Row class="hover:bg-transparent">
								<Table.Head scope="col" class="{HEAD_CLASS} w-20">เวลา</Table.Head>
								<Table.Head scope="col" class="{HEAD_CLASS} w-36">ประเภท</Table.Head>
								<Table.Head scope="col" class={HEAD_CLASS}>รายการ</Table.Head>
								<Table.Head scope="col" class="{HEAD_CLASS} text-right">จำนวน</Table.Head>
								<Table.Head scope="col" class={HEAD_CLASS}>ที่มา / ปลายทาง / เหตุผล</Table.Head>
								<Table.Head scope="col" class={HEAD_CLASS}>ล็อต · จุดเก็บ</Table.Head>
								<Table.Head scope="col" class={HEAD_CLASS}>ผู้บันทึก</Table.Head>
							</Table.Row>
						</Table.Header>
						{#each groups as group (group.dayKey)}
							<Table.Body>
								<Table.Row class="bg-slate-100 hover:bg-slate-100">
									<Table.Cell colspan={7} class="px-4 py-2.5 text-sm font-bold text-slate-700">
										{dayHeading(group.dayKey)}
									</Table.Cell>
								</Table.Row>
								{#each group.rows as row (row.id)}
									<LedgerRowView {row} />
								{/each}
							</Table.Body>
						{/each}
					</Table.Root>
				</div>

				<!-- below md: a card per movement under a heading per day -->
				<div class="space-y-4 p-3 md:hidden">
					{#each groups as group (group.dayKey)}
						<section aria-label={dayHeading(group.dayKey)}>
							<h3 class="mb-2 text-sm font-bold text-slate-700">{dayHeading(group.dayKey)}</h3>
							<ul class="space-y-2">
								{#each group.rows as row (row.id)}
									<LedgerCard {row} />
								{/each}
							</ul>
						</section>
					{/each}
				</div>

				<div
					class="flex flex-col items-center justify-between gap-2 border-t border-slate-200/80 p-3 sm:flex-row"
				>
					<span class="text-sm text-slate-600">
						แสดง {rangeStart}–{rangeEnd} จาก {filtered.length} รายการ
					</span>
					<PaginationControls
						bind:page={() => currentPage, (p) => updateUrl({ page: p })}
						count={filtered.length}
						perPage={LEDGER_PAGE_SIZE}
					/>
				</div>
			{/if}
		</section>
	{/if}
</div>

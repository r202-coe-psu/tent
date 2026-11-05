<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { useItemMasters, formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import {
		useLedger,
		useLotReservationClaims,
		projectStockLotBalances
	} from '$lib/features/operations';
	import { langState } from '$lib/states/i18n.svelte';
	import { formatQty } from '$lib/utils/qty';
	import { useShelterPeopleCounts } from '../application/shelter-people-queries';
	import {
		buildOneTimeDemandRows,
		formatCoveragePercent,
		sortOneTimeDemandRows,
		type OneTimeDemandRow
	} from '../domain/one-time-demand';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import Users from '@lucide/svelte/icons/users';

	let { shelterCode = '' }: { shelterCode?: string | null } = $props();

	const itemMastersQuery = useItemMasters();
	const unitsQuery = useUnitsOfMeasure();
	const ledgerQuery = useLedger();
	const reservationsQuery = useLotReservationClaims();
	const peopleQuery = useShelterPeopleCounts(() => shelterCode ?? '');

	const units = $derived(unitsQuery.data ?? []);
	const people = $derived(peopleQuery.data?.total ?? 0);

	const isLoading = $derived(
		itemMastersQuery.isLoading ||
			ledgerQuery.isLoading ||
			reservationsQuery.isLoading ||
			peopleQuery.isLoading
	);
	const isError = $derived(
		itemMastersQuery.isError ||
			ledgerQuery.isError ||
			reservationsQuery.isError ||
			peopleQuery.isError
	);

	const rows = $derived.by<OneTimeDemandRow[]>(() => {
		if (isLoading || isError) return [];
		return sortOneTimeDemandRows(
			buildOneTimeDemandRows({
				items: itemMastersQuery.data ?? [],
				people,
				lots: projectStockLotBalances(ledgerQuery.data ?? []),
				reservations: reservationsQuery.data ?? [],
				now: Date.now()
			})
		);
	});

	function unitLabel(row: OneTimeDemandRow) {
		return formatUnit(row.unit, units, langState.current);
	}
</script>

{#snippet statusBadge(row: OneTimeDemandRow)}
	{#if row.status === 'enough'}
		<span
			class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900"
		>
			<CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
			พอ
		</span>
	{:else}
		<span
			class="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-900"
		>
			<AlertCircle class="h-3.5 w-3.5" aria-hidden="true" />
			ไม่พอ
		</span>
	{/if}
{/snippet}

{#snippet missingQtyBadge()}
	<span
		class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900"
	>
		<AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
		ยังไม่ตั้งจำนวนต่อคน
	</span>
{/snippet}

<div class="space-y-4">
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-2xs"
	>
		<Users class="h-5 w-5 text-slate-500" aria-hidden="true" />
		<p class="text-base text-slate-700">
			คำนวณจากคนในศูนย์
			<span class="font-bold text-slate-900 tabular-nums">{formatQty(people)}</span>
			คน
		</p>
	</div>

	{#if isLoading}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-8 text-center text-base text-slate-600 shadow-2xs"
			role="status"
		>
			กำลังโหลดข้อมูล…
		</div>
	{:else if isError}
		<div
			class="flex items-center gap-3 rounded-xl border border-red-200 bg-white px-4 py-3.5 text-base text-red-900 shadow-2xs"
			role="alert"
		>
			<AlertCircle class="h-5 w-5 shrink-0" aria-hidden="true" />
			โหลดข้อมูลของแจกครั้งเดียวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
		</div>
	{:else if rows.length === 0}
		<div
			class="flex flex-col items-center rounded-xl border border-slate-200/80 bg-white p-10 text-center shadow-2xs"
		>
			<PackageOpen class="mb-4 h-12 w-12 text-slate-300" aria-hidden="true" />
			<p class="text-base font-semibold text-slate-700">ยังไม่มีสินค้าประเภทแจกครั้งเดียว</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
			<!-- Mobile: one card per item -->
			<ul class="space-y-2.5 p-3 md:hidden">
				{#each rows as row (row.itemId)}
					<li
						class="rounded-xl border bg-white p-3.5 {row.status === 'short'
							? 'border-red-200'
							: 'border-slate-200/80'}"
					>
						<div class="flex items-start justify-between gap-2">
							<span class="text-base font-semibold text-slate-900">{row.name}</span>
							{@render statusBadge(row)}
						</div>
						{#if row.qtyPerPersonMissing}
							<div class="mt-1.5">{@render missingQtyBadge()}</div>
						{/if}
						<dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
							<div>
								<dt class="text-slate-500">ต้องการ</dt>
								<dd class="font-semibold text-slate-900 tabular-nums">
									{formatQty(row.demand)}
									{unitLabel(row)}
								</dd>
							</div>
							<div>
								<dt class="text-slate-500">มีพร้อมแจก</dt>
								<dd class="font-semibold text-slate-900 tabular-nums">
									{formatQty(row.available)}
									{unitLabel(row)}
								</dd>
							</div>
							<div>
								<dt class="text-slate-500">ขาด</dt>
								<dd
									class="font-semibold tabular-nums {row.status === 'short'
										? 'text-red-700'
										: 'text-slate-900'}"
								>
									{formatQty(row.shortfall)}
									{unitLabel(row)}
								</dd>
							</div>
							<div>
								<dt class="text-slate-500">Coverage</dt>
								<dd class="font-semibold text-slate-900 tabular-nums">
									{formatCoveragePercent(row.coverage)}
								</dd>
							</div>
						</dl>
					</li>
				{/each}
			</ul>

			<!-- Tablet / desktop table -->
			<div class="hidden overflow-x-auto md:block">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-slate-50">
							<Table.Head class="px-4 py-3">สินค้า</Table.Head>
							<Table.Head class="px-4 py-3 text-right">ต้องการ</Table.Head>
							<Table.Head class="px-4 py-3 text-right">มีพร้อมแจก</Table.Head>
							<Table.Head class="px-4 py-3 text-right">ขาด</Table.Head>
							<Table.Head class="px-4 py-3 text-right">Coverage</Table.Head>
							<Table.Head class="px-4 py-3">สถานะ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each rows as row (row.itemId)}
							<Table.Row>
								<Table.Cell class="px-4 py-3">
									<span class="text-base font-semibold text-slate-900">{row.name}</span>
									{#if row.qtyPerPersonMissing}
										<div class="mt-1">{@render missingQtyBadge()}</div>
									{/if}
								</Table.Cell>
								<Table.Cell class="px-4 py-3 text-right text-base tabular-nums">
									{formatQty(row.demand)}
									<span class="text-sm text-slate-500">{unitLabel(row)}</span>
								</Table.Cell>
								<Table.Cell class="px-4 py-3 text-right text-base tabular-nums">
									{formatQty(row.available)}
									<span class="text-sm text-slate-500">{unitLabel(row)}</span>
								</Table.Cell>
								<Table.Cell
									class="px-4 py-3 text-right text-base font-semibold tabular-nums {row.status ===
									'short'
										? 'text-red-700'
										: 'text-slate-900'}"
								>
									{formatQty(row.shortfall)}
									<span class="text-sm font-normal text-slate-500">{unitLabel(row)}</span>
								</Table.Cell>
								<Table.Cell class="px-4 py-3 text-right text-base tabular-nums">
									{formatCoveragePercent(row.coverage)}
								</Table.Cell>
								<Table.Cell class="px-4 py-3">{@render statusBadge(row)}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	{/if}
</div>

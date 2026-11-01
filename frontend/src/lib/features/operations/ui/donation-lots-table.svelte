<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import { formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { useDonationLots } from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import { lotHistoryQuery } from '../domain/donation-lots';
	import { lotStorageLabel } from '../domain/lot-storage';

	/**
	 * "ล็อตที่รับเข้า" of one donation (#821 FR-12, FR-13): what the receipt put on the shelves,
	 * lot by lot, and what is left of each lot now. The lot number opens the stock movements
	 * filtered to that lot (#811).
	 */
	let { donationId, shelterCode }: { donationId: string; shelterCode: string } = $props();

	const lotsQuery = useDonationLots(() => donationId);
	const stockItems = useStockFormItems(() => shelterCode);
	const storagePoints = useStoragePoints(() => shelterCode);
	const unitsQuery = useUnitsOfMeasure();

	const rows = $derived(lotsQuery.data ?? []);
	const itemNameById = $derived(new Map(stockItems.items.map((item) => [item._id, item.name])));
	const units = $derived(unitsQuery.data ?? []);
	const supplyPath = resolve('/back-office/supply');

	const unitLabel = (unit: string) => formatUnit(unit, units, langState.current);
</script>

<section class="rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
	<h3 class="text-sm font-semibold text-slate-500">ล็อตที่รับเข้า</h3>

	{#if lotsQuery.isPending}
		<p class="mt-3 text-sm text-slate-500">กำลังโหลดข้อมูลล็อต...</p>
	{:else if lotsQuery.isError}
		<p class="mt-3 text-sm text-red-700" role="alert">
			โหลดข้อมูลล็อตไม่สำเร็จ: {lotsQuery.error.message}
		</p>
	{:else if rows.length === 0}
		<p class="mt-3 text-sm text-slate-500">ใบนี้ไม่มีรายการรับเข้าคลัง</p>
	{:else}
		<div class="mt-3 overflow-x-auto">
			<Table.Root class="w-full text-left text-sm">
				<Table.Header>
					<Table.Row>
						<Table.Head>สินค้า</Table.Head>
						<Table.Head class="text-right">จำนวน</Table.Head>
						<Table.Head>ล็อต</Table.Head>
						<Table.Head>หมดอายุ</Table.Head>
						<Table.Head>จุดจัดเก็บ</Table.Head>
						<Table.Head class="text-right">คงเหลือ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as row (row.ledgerId)}
						<Table.Row data-testid="donation-lot-row">
							<Table.Cell class="font-medium text-slate-900">
								{itemNameById.get(row.itemId) ?? row.itemId}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{row.qty}
								{unitLabel(row.unit)}
							</Table.Cell>
							<Table.Cell class="tabular-nums">
								{#if row.lotNo}
									<a
										href="{supplyPath}?{lotHistoryQuery(row.lotNo)}"
										class="font-semibold text-sky-800 underline-offset-2 hover:underline"
									>
										{row.lotNo}
									</a>
								{:else}
									—
								{/if}
							</Table.Cell>
							<Table.Cell class="tabular-nums">{row.expiry ?? '—'}</Table.Cell>
							<Table.Cell>{lotStorageLabel(row.lot, storagePoints.points)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{row.remaining === null ? '—' : `${row.remaining} ${unitLabel(row.unit)}`}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</section>

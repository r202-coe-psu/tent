<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { resolve } from '$app/paths';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { useItemMasters, formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import {
		useLedgerByItems,
		useLotReservationClaims,
		projectStockLotBalances
	} from '$lib/features/operations';
	import { useItemEvacueeRecipients } from '$lib/features/distribution';
	import { langState } from '$lib/states/i18n.svelte';
	import { formatQty } from '$lib/utils/qty';
	import { useShelterPeopleCounts } from '../application/shelter-people-queries';
	import {
		buildOneTimeDemandRows,
		countCurrentRecipients,
		formatCoveragePercent,
		oneTimeItemIds,
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
	// Read the ledger of the one-time items only, after the item list says which they are.
	const itemIds = $derived(oneTimeItemIds(itemMastersQuery.data ?? []));
	const ledgerQuery = useLedgerByItems(
		() => itemIds,
		() => itemMastersQuery.isSuccess
	);
	const reservationsQuery = useLotReservationClaims();
	const recipientsQuery = useItemEvacueeRecipients(
		() => itemIds,
		() => itemMastersQuery.isSuccess,
		() => shelterCode ?? undefined
	);
	const peopleQuery = useShelterPeopleCounts(() => shelterCode ?? '');

	const units = $derived(unitsQuery.data ?? []);
	const people = $derived(peopleQuery.data?.total ?? 0);

	const isLoading = $derived(
		itemMastersQuery.isLoading ||
			ledgerQuery.isPending ||
			reservationsQuery.isLoading ||
			recipientsQuery.isPending ||
			peopleQuery.isLoading
	);
	const isError = $derived(
		itemMastersQuery.isError ||
			ledgerQuery.isError ||
			reservationsQuery.isError ||
			recipientsQuery.isError ||
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
				receivedByItem: countCurrentRecipients(
					recipientsQuery.data ?? [],
					peopleQuery.data?.evacueeIds ?? []
				),
				now: Date.now()
			})
		);
	});

	const PAGE_SIZE = 25;
	let search = $state('');
	let visible = $state(PAGE_SIZE);

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
	});
	const shown = $derived(filtered.slice(0, visible));
	const shortCount = $derived(rows.filter((r) => r.status === 'short').length);

	/** The stock list on the inventory tab, searched by name; `all` keeps never-received items in view. */
	function stockHref(row: OneTimeDemandRow) {
		const params = new URLSearchParams({ q: row.name, all: '1' });
		return resolve(`/back-office/supply?${params}` as '/back-office/supply');
	}

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
			{#if peopleQuery.data}
				<span class="text-slate-500">
					(ผู้พักพิง {formatQty(peopleQuery.data.evacuees)} · เจ้าหน้าที่
					{formatQty(peopleQuery.data.staff)} · จิตอาสา {formatQty(peopleQuery.data.volunteers)})
				</span>
			{/if}
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
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-base text-slate-700">
				{#if shortCount > 0}
					<span class="font-bold text-red-700 tabular-nums">{shortCount}</span>
					จาก {rows.length} รายการยังแจกไม่พอ
				{:else}
					ทั้ง {rows.length} รายการแจกได้พอทุกคน
				{/if}
			</p>
			<Input
				type="search"
				class="w-full sm:w-64"
				placeholder="ค้นหาสินค้า"
				aria-label="ค้นหาสินค้า"
				bind:value={search}
				oninput={() => (visible = PAGE_SIZE)}
			/>
		</div>

		<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
			<!-- Mobile: one card per item -->
			<ul class="space-y-2.5 p-3 md:hidden">
				{#each shown as row (row.itemId)}
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
								<dt class="text-slate-500">รับแล้ว</dt>
								<dd class="font-semibold text-slate-900 tabular-nums">
									{formatQty(row.received)} คน
								</dd>
							</div>
							<div>
								<dt class="text-slate-500">ต้องแจกอีก</dt>
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
								<dt class="text-slate-500">ต้องหาเพิ่ม</dt>
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
								<dt class="text-slate-500">ครอบคลุม</dt>
								<dd class="font-semibold text-slate-900 tabular-nums">
									{formatCoveragePercent(row.coverage)}
								</dd>
							</div>
						</dl>
						<Button
							variant="outline"
							size="sm"
							class="mt-3 w-full"
							href={stockHref(row)}
							aria-label="ดูสินค้า {row.name} ในหน้าสต็อก"
						>
							ดูในสต็อก
						</Button>
					</li>
				{/each}
			</ul>

			<!-- Tablet / desktop table -->
			<div class="hidden overflow-x-auto md:block">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-slate-50">
							<Table.Head class="px-4 py-3">สินค้า</Table.Head>
							<Table.Head class="px-4 py-3 text-right">รับแล้ว</Table.Head>
							<Table.Head class="px-4 py-3 text-right">ต้องแจกอีก</Table.Head>
							<Table.Head class="px-4 py-3 text-right">มีพร้อมแจก</Table.Head>
							<Table.Head class="px-4 py-3 text-right">ต้องหาเพิ่ม</Table.Head>
							<Table.Head class="px-4 py-3 text-right">ครอบคลุม</Table.Head>
							<Table.Head class="px-4 py-3">สถานะ</Table.Head>
							<Table.Head class="px-4 py-3 text-right"
								><span class="sr-only">ดำเนินการ</span></Table.Head
							>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each shown as row (row.itemId)}
							<Table.Row>
								<Table.Cell class="px-4 py-3">
									<span class="text-base font-semibold text-slate-900">{row.name}</span>
									{#if row.qtyPerPersonMissing}
										<div class="mt-1">{@render missingQtyBadge()}</div>
									{/if}
								</Table.Cell>
								<Table.Cell class="px-4 py-3 text-right text-base tabular-nums">
									{formatQty(row.received)}
									<span class="text-sm text-slate-500">คน</span>
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
								<Table.Cell class="px-4 py-3 text-right">
									<Button
										variant="outline"
										size="sm"
										href={stockHref(row)}
										aria-label="ดูสินค้า {row.name} ในหน้าสต็อก"
									>
										ดูในสต็อก
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>

		{#if filtered.length === 0}
			<p class="text-center text-base text-slate-600">ไม่พบสินค้าที่ค้นหา</p>
		{:else if filtered.length > shown.length}
			<div class="flex justify-center">
				<Button variant="outline" onclick={() => (visible += PAGE_SIZE)}>
					ดูเพิ่ม (แสดง {shown.length} จาก {filtered.length} รายการ)
				</Button>
			</div>
		{/if}
	{/if}
</div>

<script lang="ts">
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Archive from '@lucide/svelte/icons/archive';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Package from '@lucide/svelte/icons/package';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import { Input } from '$lib/components/ui/input/index.js';
	import { useItemMasters } from '$lib/features/catalog';
	import { useSupplyItems } from '$lib/features/supply';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useBulkReturnPools, resolveAuthenticatedAuthorContext } from '../../application/queries';
	import type { BulkReturnPoolStatus } from '../../domain/food-supplies';
	import {
		BULK_POOL_STATUS_FILTERS,
		BULK_POOL_STATUS_LABELS,
		canCreateBulkReturnPool,
		filterBulkReturnPools,
		getBulkPoolAccounting,
		getBulkPoolManagerViewState,
		getBulkPoolStatusLabel,
		resolveBulkPoolItemLabel,
		type BulkPoolCatalogItem,
		type BulkPoolStatusFilter
	} from '../model/bulk-pool-manager';
	import CreateBulkPoolDialog from './CreateBulkPoolDialog.svelte';

	interface Props {
		shelterCode?: string;
	}

	let { shelterCode }: Props = $props();

	const activeShelterCode = $derived(
		shelterCode ?? shelterStore.selectedShelterCode ?? getShelterCode()
	);
	const poolsQuery = useBulkReturnPools(undefined, () => activeShelterCode);
	const itemMastersQuery = useItemMasters(() => activeShelterCode ?? null);
	const supplyItemsQuery = useSupplyItems();

	let statusFilter = $state<BulkPoolStatusFilter>('ALL');
	let searchQuery = $state('');
	let isCreateOpen = $state(false);

	const userCanCreatePool = $derived.by(() => {
		try {
			const ctx = resolveAuthenticatedAuthorContext(activeShelterCode);
			return canCreateBulkReturnPool(ctx);
		} catch {
			return false;
		}
	});

	const pools = $derived(poolsQuery.data ?? []);
	const catalogItems = $derived.by((): BulkPoolCatalogItem[] => [
		...(supplyItemsQuery.data ?? []).map((item) => ({ _id: item._id, name: item.name })),
		...(itemMastersQuery.data ?? []).map((item) => ({
			_id: item._id,
			name: item.name,
			sku: item.sku
		}))
	]);
	const filteredPools = $derived(
		filterBulkReturnPools(pools, statusFilter, searchQuery, catalogItems)
	);
	const viewState = $derived(
		getBulkPoolManagerViewState(
			Boolean(poolsQuery.isLoading),
			Boolean(poolsQuery.isError),
			pools.length,
			filteredPools.length
		)
	);

	function formatDateTime(value: string): string {
		try {
			return new Intl.DateTimeFormat('th-TH', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			}).format(new Date(value));
		} catch {
			return value;
		}
	}

	function statusClass(status: BulkReturnPoolStatus): string {
		if (status === 'ACTIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
		if (status === 'EXHAUSTED') return 'border-amber-200 bg-amber-50 text-amber-900';
		return 'border-slate-200 bg-slate-100 text-slate-800';
	}
</script>

<svelte:head>
	<title>จุดรวมคืนพัสดุ · SmartShelter</title>
</svelte:head>

<section class="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
	<div
		class="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex items-center gap-3">
			<div
				class="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 shadow-2xs"
			>
				<Package class="h-6 w-6" aria-hidden="true" />
			</div>
			<div>
				<p class="text-2xs font-bold tracking-wide text-violet-700 uppercase">คลังรับคืน</p>
				<h2 class="text-lg font-bold text-slate-900">จุดรวมคืนพัสดุ (Bulk Return Pools)</h2>
				<p class="text-xs text-slate-500">ดูโควตาและประวัติการรับคืนของศูนย์ {activeShelterCode}</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<span
				class="inline-flex items-center gap-1.5 self-start rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 sm:self-auto"
			>
				<Archive class="h-3.5 w-3.5" aria-hidden="true" />
				อ่านอย่างเดียว
			</span>
			{#if userCanCreatePool}
				<button
					type="button"
					onclick={() => (isCreateOpen = true)}
					class="inline-flex items-center gap-1.5 rounded-xl bg-violet-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-violet-800"
				>
					<Plus class="h-4 w-4" aria-hidden="true" />
					<span>เปิดจุดรวมคืนพัสดุ</span>
				</button>
			{/if}
		</div>
	</div>

	<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
		<div class="flex flex-wrap gap-2" role="tablist" aria-label="กรองสถานะจุดรวมคืน">
			{#each BULK_POOL_STATUS_FILTERS as filter (filter)}
				<button
					type="button"
					role="tab"
					aria-selected={statusFilter === filter}
					onclick={() => (statusFilter = filter)}
					class="rounded-lg border px-3 py-2 text-xs font-semibold transition-colors {statusFilter ===
					filter
						? 'border-[#0A2647] bg-[#0A2647] text-white'
						: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'}"
				>
					{BULK_POOL_STATUS_LABELS[filter]}
				</button>
			{/each}
		</div>

		<div class="relative w-full lg:max-w-sm">
			<Search
				class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
				aria-hidden="true"
			/>
			<Input
				type="search"
				value={searchQuery}
				oninput={(event) => (searchQuery = event.currentTarget.value)}
				placeholder="ค้นหาชื่อสินค้า หรือ SKU..."
				aria-label="ค้นหาจุดรวมคืนตามชื่อสินค้า หรือ SKU"
				class="h-10 w-full pl-9 text-sm shadow-2xs placeholder:text-slate-400"
			/>
		</div>
	</div>

	{#if viewState === 'loading'}
		<div class="rounded-xl border border-slate-200 bg-slate-50 p-12 text-center">
			<RefreshCw class="mx-auto mb-2 h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
			<p class="text-sm font-semibold text-slate-800">กำลังโหลดข้อมูลจุดรวมคืน...</p>
		</div>
	{:else if viewState === 'error'}
		<div class="rounded-xl border border-red-200 bg-red-50/60 p-10 text-center">
			<AlertCircle class="mx-auto mb-2 h-8 w-8 text-red-500" aria-hidden="true" />
			<h3 class="text-sm font-bold text-red-900">ไม่สามารถโหลดข้อมูลจุดรวมคืนได้</h3>
			<p class="mt-1 text-xs text-red-700">กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
			<button
				type="button"
				onclick={() => poolsQuery.refetch()}
				class="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 shadow-2xs hover:bg-red-50"
			>
				<RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
				ลองใหม่
			</button>
		</div>
	{:else if viewState === 'empty'}
		<div class="rounded-xl border border-slate-200 bg-slate-50 p-12 text-center">
			<Inbox class="mx-auto mb-2 h-8 w-8 text-slate-400" aria-hidden="true" />
			<h3 class="text-sm font-semibold text-slate-900">ยังไม่มีจุดรวมคืน</h3>
			<p class="mt-1 text-xs text-slate-500">ยังไม่มีข้อมูลจุดรวมคืนในศูนย์นี้</p>
		</div>
	{:else if viewState === 'search_empty'}
		<div class="rounded-xl border border-slate-200 bg-slate-50 p-12 text-center">
			<XCircle class="mx-auto mb-2 h-8 w-8 text-slate-400" aria-hidden="true" />
			<h3 class="text-sm font-semibold text-slate-900">ไม่พบจุดรวมคืนที่ตรงกับการค้นหา</h3>
			<p class="mt-1 text-xs text-slate-500">ลองค้นหาด้วยชื่อสินค้า หรือ SKU อื่น</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-slate-200/80">
			<div class="overflow-x-auto">
				<table class="w-full min-w-[980px] text-left text-sm text-slate-700">
					<thead
						class="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold tracking-wide text-slate-600"
					>
						<tr>
							<th scope="col" class="py-3.5 pr-3 pl-4">สินค้า</th>
							<th scope="col" class="px-3 py-3.5">สถานะ</th>
							<th scope="col" class="px-3 py-3.5 text-right">รับเข้ารวม</th>
							<th scope="col" class="px-3 py-3.5 text-right">ใช้ไปแล้ว</th>
							<th scope="col" class="px-3 py-3.5 text-right">คงเหลือ</th>
							<th scope="col" class="px-3 py-3.5 text-right">จำนวน claim</th>
							<th scope="col" class="px-3 py-3.5">สร้างเมื่อ / ผู้สร้าง</th>
							<th scope="col" class="py-3.5 pr-4 pl-3">การปิด</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each filteredPools as pool (pool._id)}
							{@const item = resolveBulkPoolItemLabel(pool.item_id, catalogItems)}
							{@const accounting = getBulkPoolAccounting(pool)}
							<tr class="transition-colors hover:bg-slate-50/80">
								<td class="py-4 pr-3 pl-4">
									<div class="font-semibold text-slate-900">{item.name}</div>
									<div class="mt-0.5 font-mono text-2xs text-slate-500">{pool.item_id}</div>
									{#if item.sku}
										<div class="mt-0.5 text-2xs text-slate-500">SKU: {item.sku}</div>
									{/if}
								</td>
								<td class="px-3 py-4 align-top">
									<span
										class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold {statusClass(
											pool.status
										)}"
									>
										{#if pool.status === 'ACTIVE'}
											<CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
										{:else if pool.status === 'EXHAUSTED'}
											<AlertCircle class="h-3.5 w-3.5" aria-hidden="true" />
										{:else}
											<Archive class="h-3.5 w-3.5" aria-hidden="true" />
										{/if}
										{getBulkPoolStatusLabel(pool.status)}
									</span>
								</td>
								<td class="px-3 py-4 text-right font-mono tabular-nums"
									>{accounting.totalReceived}</td
								>
								<td class="px-3 py-4 text-right font-mono tabular-nums">{accounting.claimed}</td>
								<td class="px-3 py-4 text-right font-mono font-semibold text-slate-900 tabular-nums"
									>{accounting.remaining}</td
								>
								<td class="px-3 py-4 text-right font-mono tabular-nums">{accounting.claimCount}</td>
								<td class="px-3 py-4 align-top">
									<div>{formatDateTime(pool.created_at)}</div>
									<div class="mt-0.5 text-xs text-slate-500">{pool.created_by}</div>
									{#if pool.ticket_id}
										<div class="mt-1 font-mono text-2xs text-slate-500">ตั๋ว: {pool.ticket_id}</div>
									{/if}
									{#if pool.shift_id}
										<div class="font-mono text-2xs text-slate-500">รอบ: {pool.shift_id}</div>
									{/if}
								</td>
								<td class="py-4 pr-4 pl-3 align-top text-xs text-slate-600">
									{#if pool.status === 'CLOSED'}
										<div>{pool.closed_at ? formatDateTime(pool.closed_at) : 'ไม่ระบุเวลา'}</div>
										<div class="mt-0.5">โดย {pool.closed_by ?? 'ไม่ระบุผู้ปิด'}</div>
									{:else}
										<span class="text-slate-400">ยังไม่ปิด</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</section>

<CreateBulkPoolDialog
	bind:open={isCreateOpen}
	shelterCode={activeShelterCode}
	onClose={() => (isCreateOpen = false)}
/>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Search from '@lucide/svelte/icons/search';
	import { useCatalogSearch, useWarehouses } from '../application/central-warehouse-queries';
	import { formatQty } from './central-warehouse.ui';

	let {
		enabled,
		onViewStock
	}: {
		/** False while the M6 gate is closed: nothing is fetched. */
		enabled: boolean;
		/** Jump to the warehouse tab on `warehouseCode`, searching for `name`. */
		onViewStock: (warehouseCode: string, name: string) => void;
	} = $props();

	const MIN_QUERY = 2;
	const ANY_WAREHOUSE = '__any__';

	let input = $state('');
	/** The term last submitted — the search runs on submit, not on every keystroke. */
	let q = $state('');
	let warehouseCode = $state(ANY_WAREHOUSE);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		q = input.trim();
	}

	const warehousesQuery = useWarehouses(() => enabled);
	const warehouses = $derived(warehousesQuery.data ?? []);
	const warehouseLabel = $derived(
		warehouseCode === ANY_WAREHOUSE
			? 'ทุกคลัง (ดูจำนวนคลังที่มี)'
			: (warehouses.find((w) => w.warehouse_code === warehouseCode)?.name ?? warehouseCode)
	);

	const ready = $derived(enabled && q.length >= MIN_QUERY);
	const search = useCatalogSearch(
		() => ({
			q,
			warehouse_code: warehouseCode === ANY_WAREHOUSE ? '' : warehouseCode,
			type_code: ''
		}),
		() => ready
	);
	const results = $derived(search.data?.data ?? []);
	const scoped = $derived(warehouseCode !== ANY_WAREHOUSE);
</script>

<section
	aria-label="ค้นหาของในแคตตาล็อกกลาง"
	class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
>
	<form class="grid grid-cols-1 gap-3 sm:grid-cols-4" onsubmit={submit}>
		<div class="space-y-1.5 sm:col-span-2">
			<Label for="m6-catalog-q" class="text-sm font-semibold text-slate-700">ค้นหาสิ่งของ</Label>
			<Input
				id="m6-catalog-q"
				type="search"
				placeholder="เช่น น้ำดื่ม ข้าวสาร ผ้าห่ม"
				bind:value={input}
				disabled={!enabled}
				class="h-11 sm:h-10"
			/>
		</div>
		<div class="space-y-1.5">
			<Label for="m6-catalog-warehouse" class="text-sm font-semibold text-slate-700">
				ตรวจในคลัง
			</Label>
			<Select.Root type="single" bind:value={warehouseCode} disabled={!enabled}>
				<Select.Trigger id="m6-catalog-warehouse" class="h-11 w-full sm:h-10">
					{warehouseLabel}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value={ANY_WAREHOUSE} label="ทุกคลัง (ดูจำนวนคลังที่มี)" />
					{#each warehouses as w (w.warehouse_code)}
						<Select.Item value={w.warehouse_code} label={w.name} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="flex items-end">
			<Button type="submit" class="h-11 w-full gap-2 sm:h-10" disabled={!enabled}>
				<Search class="h-4 w-4" aria-hidden="true" />
				ค้นหา
			</Button>
		</div>
	</form>

	{#if !enabled}
		<p class="text-sm text-slate-500">ค้นหาไม่ได้ในตอนนี้ เพราะยังเชื่อมต่อ M6 ไม่ได้</p>
	{:else if !ready}
		<p class="text-sm text-slate-500">
			พิมพ์ชื่อสิ่งของอย่างน้อย {MIN_QUERY} ตัวอักษรแล้วกด "ค้นหา"
		</p>
	{:else if search.isPending}
		<div class="space-y-2">
			{#each [1, 2, 3] as n (n)}
				<Skeleton class="h-14 w-full rounded-lg" />
			{/each}
		</div>
	{:else if search.isError}
		<div class="space-y-2 text-sm text-red-900">
			<p>ค้นหาไม่สำเร็จ: {search.error.message}</p>
			<Button variant="outline" class="h-11" onclick={() => search.refetch()}>ลองใหม่</Button>
		</div>
	{:else if results.length === 0}
		<p class="text-sm text-slate-500">ไม่พบสิ่งของที่ตรงกับ "{q}"</p>
	{:else}
		<ul class="divide-y divide-slate-100 rounded-lg border border-slate-200">
			{#each results as item (item.reference_id)}
				<li class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
					<div class="min-w-0">
						<p class="text-sm font-bold break-words text-slate-900">{item.name_th}</p>
						<p class="text-xs text-slate-500">
							{item.name_en ? `${item.name_en} · ` : ''}{item.type_code ?? 'ไม่ระบุประเภท'}
							{item.base_unit ? ` · หน่วย ${item.base_unit}` : ''}
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<span
							class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 tabular-nums"
						>
							มีใน {formatQty(item.warehouses_count)} คลัง
						</span>
						{#if scoped && item.in_warehouse === true}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
							>
								<CircleCheck class="h-3.5 w-3.5" aria-hidden="true" />
								มีในคลังนี้
							</span>
							<Button
								variant="outline"
								size="sm"
								class="h-11 sm:h-9"
								onclick={() => onViewStock(warehouseCode, item.name_th)}
							>
								ดูสต็อกในคลังนี้
							</Button>
						{:else if scoped}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700"
							>
								<CircleX class="h-3.5 w-3.5" aria-hidden="true" />
								ไม่มีในคลังนี้
							</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if search.data && (search.data.total ?? 0) > results.length}
			<p class="text-sm text-slate-500 tabular-nums">
				แสดง {results.length} จาก {search.data.total} รายการ ระบุคำค้นให้เจาะจงขึ้นเพื่อลดผลลัพธ์
			</p>
		{/if}
	{/if}
</section>

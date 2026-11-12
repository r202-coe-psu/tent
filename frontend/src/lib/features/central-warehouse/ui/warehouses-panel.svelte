<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import { toast } from 'svelte-sonner';
	import { useWarehouses, useWarehouseStock } from '../application/central-warehouse-queries';
	import type { WithdrawalCartState } from '../application/withdrawal-cart.svelte';
	import type { StockItem, Warehouse as WarehouseRow } from '../domain/central-warehouse.schema';
	import { formatQty, warehouseMapHref } from './central-warehouse.ui';

	let {
		cart,
		enabled,
		selectedCode = $bindable(null),
		stockSearch = $bindable(''),
		onOpenCart
	}: {
		cart: WithdrawalCartState;
		/** False while the M6 gate is closed: nothing is fetched and nothing can be added. */
		enabled: boolean;
		selectedCode?: string | null;
		stockSearch?: string;
		onOpenCart: () => void;
	} = $props();

	const PAGE_SIZE = 100;
	const ALL_TYPES = '__all__';

	const warehousesQuery = useWarehouses(() => enabled);
	const warehouses = $derived(warehousesQuery.data ?? []);
	const selected = $derived(warehouses.find((w) => w.warehouse_code === selectedCode) ?? null);

	const stockQuery = useWarehouseStock(() => (enabled ? selectedCode : null));
	const stockItems = $derived(stockQuery.data?.data ?? []);

	let typeFilter = $state(ALL_TYPES);
	let visible = $state(PAGE_SIZE);

	const typeCodes = $derived(
		[...new Set(stockItems.map((i) => i.type_code).filter((t): t is string => !!t))].sort()
	);
	const filtered = $derived.by(() => {
		const q = stockSearch.trim().toLowerCase();
		return stockItems.filter(
			(i) =>
				(typeFilter === ALL_TYPES || i.type_code === typeFilter) &&
				(!q || i.name.toLowerCase().includes(q) || i.item_code.toLowerCase().includes(q))
		);
	});
	const shown = $derived(filtered.slice(0, visible));
	const typeLabel = $derived(typeFilter === ALL_TYPES ? 'ทุกประเภท' : typeFilter);

	function select(code: string) {
		if (code === selectedCode) return;
		selectedCode = code;
		stockSearch = '';
		typeFilter = ALL_TYPES;
		visible = PAGE_SIZE;
	}

	/** An add that would mix warehouses waits here for the user to agree to clear the cart. */
	let pendingAdd = $state<{ warehouse: WarehouseRow; item: StockItem } | null>(null);

	function add(item: StockItem) {
		if (!selected) return;
		if (cart.needsClear(selected.warehouse_code)) {
			pendingAdd = { warehouse: selected, item };
			return;
		}
		cart.add(selected, item);
		toast.success(`เพิ่ม "${item.name}" ลงตะกร้าแล้ว`);
	}

	function confirmReplace() {
		if (!pendingAdd) return;
		cart.replaceWith(pendingAdd.warehouse, pendingAdd.item);
		toast.success(`ล้างตะกร้าเดิมและเพิ่ม "${pendingAdd.item.name}" แล้ว`);
		pendingAdd = null;
	}

	const inCart = (code: string) => cart.cart.lines.some((l) => l.item_code === code);
</script>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
	<section
		aria-label="รายการคลังกลาง"
		class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs lg:col-span-4"
	>
		<h3 class="text-lg font-bold text-slate-900">คลังกลาง</h3>
		{#if !enabled}
			<p class="text-sm text-slate-500">ดูคลังไม่ได้ในตอนนี้ เพราะยังเชื่อมต่อ M6 ไม่ได้</p>
		{:else if warehousesQuery.isPending}
			<div class="space-y-2">
				{#each [1, 2, 3] as n (n)}
					<Skeleton class="h-16 w-full rounded-lg" />
				{/each}
			</div>
		{:else if warehousesQuery.isError}
			<div class="space-y-2 text-sm text-red-900">
				<p>โหลดรายการคลังไม่สำเร็จ</p>
				<Button variant="outline" class="h-11" onclick={() => warehousesQuery.refetch()}>
					ลองใหม่
				</Button>
			</div>
		{:else if warehouses.length === 0}
			<p class="text-sm text-slate-500">ไม่พบคลังที่ใช้งานได้</p>
		{:else}
			<ul class="space-y-1.5">
				{#each warehouses as w (w.warehouse_code)}
					{@const map = warehouseMapHref(w)}
					<li>
						<div
							class="flex items-start gap-2 rounded-lg border p-3 {w.warehouse_code === selectedCode
								? 'border-sky-300 bg-sky-50'
								: 'border-slate-200 bg-white'}"
						>
							<button
								type="button"
								class="flex min-h-11 min-w-0 flex-1 items-start gap-2 text-left focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
								aria-pressed={w.warehouse_code === selectedCode}
								onclick={() => select(w.warehouse_code)}
							>
								<Warehouse class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
								<span class="min-w-0">
									<span class="block text-sm font-bold break-words text-slate-900">{w.name}</span>
									<span class="block text-xs text-slate-500">
										{w.district ? `อ.${w.district} · ` : ''}รหัส {w.warehouse_code}
									</span>
								</span>
							</button>
							{#if map}
								<a
									href={map}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sky-800 hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
								>
									<ExternalLink class="h-4 w-4" aria-hidden="true" />
									<span class="sr-only">ดูแผนที่ {w.name}</span>
								</a>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section
		aria-label="สต็อกของคลังที่เลือก"
		class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs lg:col-span-8"
	>
		{#if !selected}
			<p class="text-sm text-slate-500">เลือกคลังทางซ้ายเพื่อดูสต็อก</p>
		{:else}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h3 class="text-lg font-bold text-slate-900">สต็อก · {selected.name}</h3>
				{#if cart.count > 0}
					<Button variant="outline" class="h-11 gap-2" onclick={onOpenCart}>
						<ShoppingCart class="h-4 w-4" aria-hidden="true" />
						ตะกร้า ({cart.count})
					</Button>
				{/if}
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<div class="relative space-y-1.5 sm:col-span-2">
					<Label for="m6-stock-search" class="text-sm font-semibold text-slate-700">
						ค้นหาสิ่งของ
					</Label>
					<Search class="absolute top-[2.4rem] left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
					<Input
						id="m6-stock-search"
						type="search"
						placeholder="ชื่อหรือรหัสสิ่งของ"
						bind:value={stockSearch}
						oninput={() => (visible = PAGE_SIZE)}
						class="h-11 pl-9 sm:h-10"
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="m6-stock-type" class="text-sm font-semibold text-slate-700">ประเภท</Label>
					<Select.Root
						type="single"
						bind:value={typeFilter}
						onValueChange={() => (visible = PAGE_SIZE)}
					>
						<Select.Trigger id="m6-stock-type" class="h-11 w-full sm:h-10">
							{typeLabel}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={ALL_TYPES} label="ทุกประเภท" />
							{#each typeCodes as t (t)}
								<Select.Item value={t} label={t} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			{#if stockQuery.isPending}
				<div class="space-y-2">
					{#each [1, 2, 3, 4] as n (n)}
						<Skeleton class="h-10 w-full rounded-lg" />
					{/each}
				</div>
			{:else if stockQuery.isError}
				<div class="space-y-2 text-sm text-red-900">
					<p>โหลดสต็อกไม่สำเร็จ: {stockQuery.error.message}</p>
					<Button variant="outline" class="h-11" onclick={() => stockQuery.refetch()}>
						ลองใหม่
					</Button>
				</div>
			{:else if filtered.length === 0}
				<p class="text-sm text-slate-500">ไม่พบสิ่งของที่ตรงกับการค้นหา</p>
			{:else}
				<div class="overflow-x-auto rounded-lg border border-slate-200">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>สิ่งของ</Table.Head>
								<Table.Head>ประเภท</Table.Head>
								<Table.Head>หน่วย</Table.Head>
								<Table.Head class="text-right">คงเหลือที่เบิกได้</Table.Head>
								<Table.Head><span class="sr-only">เพิ่มลงตะกร้า</span></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each shown as item (item.item_code)}
								<Table.Row>
									<Table.Cell class="font-medium text-slate-900">
										{item.name}
										<span class="block text-xs font-normal text-slate-500">{item.item_code}</span>
									</Table.Cell>
									<Table.Cell class="text-slate-700">{item.type_code ?? '–'}</Table.Cell>
									<Table.Cell class="text-slate-700">{item.unit}</Table.Cell>
									<Table.Cell class="text-right font-semibold text-slate-900 tabular-nums">
										{formatQty(item.available)}
									</Table.Cell>
									<Table.Cell class="text-right">
										<Button
											variant="outline"
											size="sm"
											class="h-11 gap-1.5 sm:h-9"
											disabled={!enabled}
											onclick={() => add(item)}
										>
											<Plus class="h-4 w-4" aria-hidden="true" />
											{inCart(item.item_code) ? 'เพิ่มอีก' : 'เพิ่มลงตะกร้า'}
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
					<span class="tabular-nums">แสดง {shown.length} จาก {filtered.length} รายการ</span>
					{#if filtered.length > shown.length}
						<Button variant="outline" class="h-11 sm:h-9" onclick={() => (visible += PAGE_SIZE)}>
							แสดงเพิ่ม
						</Button>
					{/if}
				</div>
			{/if}
		{/if}
	</section>
</div>

<Dialog.Root open={pendingAdd !== null} onOpenChange={(o) => !o && (pendingAdd = null)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>เปลี่ยนคลังต้นทาง</Dialog.Title>
			<Dialog.Description>
				ตะกร้าเบิกได้ครั้งละ 1 คลัง ตอนนี้มีของจาก "{cart.cart.warehouse_name}" อยู่ {cart.count}
				รายการ ถ้าเพิ่มของจาก "{pendingAdd?.warehouse.name}" ระบบจะล้างตะกร้าเดิมก่อน
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" class="h-11" onclick={() => (pendingAdd = null)}>ยกเลิก</Button>
			<Button class="h-11" onclick={confirmReplace}>ล้างตะกร้าแล้วเพิ่ม</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

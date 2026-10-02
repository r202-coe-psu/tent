<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, isWarehouseStaff } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Boxes from '@lucide/svelte/icons/boxes';
	import { catalogOrigin, resolveCategoryLabel, type ItemMaster } from '../domain/catalog';
	import { formatUnit } from '../domain/unit-of-measure';
	import {
		useItemCategories,
		useItemMasters,
		useUnitsOfMeasure,
		useDeleteItemMaster,
		useUpdateItemMaster
	} from '../application/queries';
	import { langState } from '$lib/states/i18n.svelte';
	import MasterFilterBar from './master/master-filter-bar.svelte';
	import MasterPager from './master/master-pager.svelte';
	import MasterItemRow from './master/master-item-row.svelte';
	import MasterItemCard from './master/master-item-card.svelte';
	import MasterItemSheet from './master/master-item-sheet.svelte';
	import MasterCategories from './master/master-categories.svelte';
	import { useMasterPaging } from './master/use-master-paging.svelte';
	import {
		filterItems,
		hiddenDeactivatedItems,
		MASTER_PAGE_SIZE,
		ORIGIN_LABELS,
		pageSlice,
		unitLines,
		type CatalogOriginKey,
		type ItemFilter,
		type ItemSheetAction,
		type ItemSheetMode,
		type MasterItemRow as MasterItemRowData,
		type OriginFilter
	} from './master/master-view';

	let {
		basePath,
		scope
	}: {
		basePath: string;
		scope: 'central' | 'shelter';
	} = $props();

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const shelterCode = $derived(scope === 'central' ? null : getShelterCode());

	const canWrite = $derived(
		isSA || (scope === 'shelter' && (isShelterManager(roles) || isWarehouseStaff(roles)))
	);

	const categoriesQuery = useItemCategories(() => shelterCode);
	const itemsQuery = useItemMasters(() => shelterCode);
	const unitsQuery = useUnitsOfMeasure();
	const deleteItemMutation = useDeleteItemMaster();
	const updateItemMutation = useUpdateItemMaster();

	const categories = $derived(categoriesQuery.data ?? []);
	const items = $derived(itemsQuery.data ?? []);
	const units = $derived(unitsQuery.data ?? []);

	let view = $state<'items' | 'categories'>('items');

	// —— filters (local state: the supply page owns the query string) ——
	let q = $state('');
	let categoryId = $state('all');
	let origin = $state<OriginFilter>('all');
	let showDeactivated = $state(false);

	const filter = $derived<ItemFilter>({ q, categoryId, origin, showDeactivated });
	const filtered = $derived(filterItems(items, categories, filter, shelterCode));
	const hiddenCount = $derived(hiddenDeactivatedItems(items, categories, filter, shelterCode));
	const filtersActive = $derived(q.trim() !== '' || categoryId !== 'all' || origin !== 'all');

	const paging = useMasterPaging(
		() => JSON.stringify([q, categoryId, origin, showDeactivated]),
		() => filtered.length
	);

	const categoryOptions = $derived(
		categories
			.filter((c) => showDeactivated || !c.deactivated)
			.map((c) => ({ value: c._id, label: c.name }))
			.sort((a, b) => a.label.localeCompare(b.label, 'th'))
	);
	const originOptions = (Object.keys(ORIGIN_LABELS) as CatalogOriginKey[]).map((k) => ({
		value: k,
		label: ORIGIN_LABELS[k]
	}));

	function onFilterSelect(id: string, value: string) {
		if (id === 'category') categoryId = value;
		else if (id === 'origin') origin = value as OriginFilter;
	}

	function clearFilters() {
		q = '';
		categoryId = 'all';
		origin = 'all';
	}

	const formatCode = (code: string) => formatUnit(code, units, langState.current);

	function categoryLabelOf(item: ItemMaster): string {
		return item.category ? resolveCategoryLabel(item.category, categories) || item.category : '';
	}

	const pageRows = $derived<MasterItemRowData[]>(
		pageSlice(filtered, paging.page, MASTER_PAGE_SIZE).map((item) => ({
			item,
			categoryLabel: categoryLabelOf(item),
			unitLines: unitLines(item, formatCode),
			origin: catalogOrigin(item, shelterCode)
		}))
	);

	// —— permissions ——
	function canEditItem(item: ItemMaster): boolean {
		if (scope === 'central') return isSA && !item.shelter_code;
		return canWrite;
	}

	function itemActionKind(item: ItemMaster): ItemSheetAction {
		if (!canEditItem(item)) return 'none';
		if (scope === 'central') return 'toggle';
		const kind = catalogOrigin(item, shelterCode);
		if (kind === 'local') return 'delete';
		if (kind === 'override') return 'reset';
		return 'central';
	}

	// —— item sheet ——
	let sheetOpen = $state(false);
	let sheetMode = $state<ItemSheetMode>('view');
	let selectedId = $state('');
	const selectedItem = $derived(items.find((i) => i._id === selectedId) ?? null);

	/** Category a new item starts in: the filtered one, else the first active category. */
	const defaultCategoryId = $derived(
		categoryId !== 'all' ? categoryId : categories.find((c) => !c.deactivated)?._id
	);

	function openItem(row: MasterItemRowData) {
		selectedId = row.item._id;
		sheetMode = 'view';
		sheetOpen = true;
	}

	function openCreateItem() {
		if (!defaultCategoryId) {
			toast.error('กรุณาเพิ่มหมวดสินค้าก่อนสร้างสินค้า');
			return;
		}
		selectedId = '';
		sheetMode = 'create';
		sheetOpen = true;
	}

	function clearCreateActionParam() {
		if (page.url.searchParams.get('action') !== 'create') return;
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.delete('action');
		const qs = params.toString();
		const path = `${page.url.pathname}${qs ? `?${qs}` : ''}${page.url.hash}`;
		void goto(resolve(path as '/back-office/supply'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	// The stock page's "เพิ่มของใหม่" link lands here with `?action=create`.
	$effect(() => {
		if (page.url.searchParams.get('action') !== 'create') return;
		if (categoriesQuery.isLoading) return;

		if (canWrite) {
			view = 'items';
			openCreateItem();
		}
		clearCreateActionParam();
	});

	// —— deactivate / reset / delete ——
	let confirmOpen = $state(false);
	let pendingAction = $state<{
		kind: 'delete' | 'reset' | 'deactivate';
		item: ItemMaster;
	} | null>(null);

	function requestItemAction(item: ItemMaster, kind: 'delete' | 'reset' | 'deactivate') {
		pendingAction = { kind, item };
		confirmOpen = true;
	}

	function activateItem(item: ItemMaster) {
		updateItemMutation.mutate(
			{ ...item, deactivated: false },
			{
				onSuccess: () => toast.success(`เปิดใช้งาน "${item.name}" สำเร็จ`),
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}

	function finishAction() {
		confirmOpen = false;
		pendingAction = null;
		sheetOpen = false;
	}

	function confirmPendingAction() {
		if (!pendingAction) return;
		const { kind, item } = pendingAction;

		if (kind === 'deactivate') {
			updateItemMutation.mutate(
				{ ...item, deactivated: true },
				{
					onSuccess: () => {
						toast.success(`ปิดใช้งาน "${item.name}" สำเร็จ`);
						finishAction();
					},
					onError: (err: Error) => toast.error(err.message)
				}
			);
			return;
		}

		deleteItemMutation.mutate(
			{ id: item._id, shelterCode },
			{
				onSuccess: (wasDeleted) => {
					if (kind === 'reset') {
						toast.success(`คืนค่ามาตรฐานรายการ "${item.name}" สำเร็จ`);
					} else if (!wasDeleted) {
						toast.success(`เปลี่ยนสถานะรายการ "${item.name}" เป็นปิดใช้งานแล้ว`);
					} else {
						toast.success(`ลบรายการ "${item.name}" สำเร็จ`);
					}
					finishAction();
				},
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}

	const confirmTitle = $derived.by(() => {
		if (!pendingAction) return '';
		return pendingAction.kind === 'reset' ? 'คืนค่ามาตรฐาน' : 'ปิดใช้งานรายการ';
	});

	const confirmBody = $derived.by(() => {
		if (!pendingAction) return '';
		const name = pendingAction.item.name;
		if (pendingAction.kind === 'reset') {
			return `ต้องการคืนค่ามาตรฐานของ "${name}" หรือไม่? การปรับแต่งของศูนย์จะถูกลบ`;
		}
		if (pendingAction.kind === 'deactivate') {
			return `ต้องการปิดใช้งาน "${name}" หรือไม่? รายการจะไม่แสดงในการเลือกใหม่ แต่ประวัติเก่ายังอยู่`;
		}
		return `ต้องการปิดใช้งาน "${name}" หรือไม่? หากยังไม่มีประวัติในคลัง ระบบจะลบรายการออกถาวร แต่ถ้ามีการใช้ไปแล้วจะเปลี่ยนเป็นปิดใช้งานแทน`;
	});

	const confirmButtonLabel = $derived.by(() => {
		if (!pendingAction) return 'ยืนยัน';
		return pendingAction.kind === 'reset' ? 'ยืนยันคืนค่า' : 'ยืนยันปิดใช้งาน';
	});
</script>

<div class="space-y-4 pb-20 md:pb-0">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<Tabs.Root bind:value={view}>
			<Tabs.List class="h-11 w-full sm:w-auto">
				<Tabs.Trigger value="items" class="min-h-9 px-4">รายการสินค้า</Tabs.Trigger>
				<Tabs.Trigger value="categories" class="min-h-9 px-4">หมวดสินค้า</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
		{#if canWrite && view === 'items'}
			<Button
				type="button"
				class="hidden min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930] md:inline-flex"
				onclick={openCreateItem}
			>
				<Plus class="h-4 w-4" aria-hidden="true" />
				เพิ่มสินค้า
			</Button>
		{/if}
	</div>

	{#if view === 'categories'}
		<MasterCategories
			{categories}
			{items}
			isLoading={categoriesQuery.isLoading}
			{scope}
			{basePath}
			{shelterCode}
			{isSA}
			{canWrite}
		/>
	{:else}
		<div
			class="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
		>
			<MasterFilterBar
				bind:q
				bind:showDeactivated
				searchLabel="ค้นหาชื่อหรือ SKU"
				searchPlaceholder="ค้นหาชื่อ / SKU"
				switchId="catalog-show-deactivated"
				selects={[
					{
						id: 'category',
						label: 'กรองหมวดหมู่',
						prefix: 'หมวด',
						value: categoryId,
						options: categoryOptions
					},
					{
						id: 'origin',
						label: 'กรองที่มา',
						prefix: 'ที่มา',
						value: origin,
						options: originOptions
					}
				]}
				onselect={onFilterSelect}
			/>

			{#if itemsQuery.isLoading}
				<div class="flex-1 space-y-3 p-4">
					{#each [0, 1, 2, 3, 4] as i (i)}
						<div class="h-16 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"></div>
					{/each}
				</div>
			{:else}
				<p
					class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-4 py-2.5 text-sm text-slate-600"
				>
					<span>
						กำลังแสดง
						<strong class="font-semibold text-slate-900 tabular-nums">{filtered.length}</strong>
						รายการ
					</span>
					{#if hiddenCount > 0}
						<span aria-hidden="true" class="text-slate-400">·</span>
						<span>ซ่อน {hiddenCount} รายการที่ปิดใช้งาน</span>
					{/if}
					{#if filtersActive}
						<button
							type="button"
							onclick={clearFilters}
							class="min-h-11 rounded px-2 font-semibold text-sky-800 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
						>
							ล้างตัวกรอง
						</button>
					{/if}
				</p>

				{#if filtered.length === 0}
					<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
						<Boxes class="h-12 w-12 text-slate-300" aria-hidden="true" />
						<p class="text-sm font-medium text-slate-500">
							{items.length === 0 ? 'ยังไม่มีรายการสินค้า' : 'ไม่พบรายการที่ตรงเงื่อนไข'}
						</p>
						{#if filtersActive}
							<Button
								type="button"
								variant="outline"
								class="min-h-11 rounded-lg border-slate-300 text-sm font-semibold"
								onclick={clearFilters}
							>
								ล้างตัวกรอง
							</Button>
						{/if}
					</div>
				{:else}
					<ul class="space-y-2.5 p-3 md:hidden">
						{#each pageRows as row (row.item._id)}
							<li><MasterItemCard {row} onopen={openItem} /></li>
						{/each}
					</ul>

					<div class="hidden flex-1 overflow-x-auto md:block">
						<Table.Root class="text-sm">
							<Table.Header class="border-b border-slate-200/80 bg-slate-50">
								<Table.Row class="text-xs font-semibold text-slate-600">
									<Table.Head class="px-4 py-3">สินค้า</Table.Head>
									<Table.Head class="px-4 py-3">หน่วย / บรรจุ</Table.Head>
									<Table.Head class="px-4 py-3">ที่มา</Table.Head>
									<Table.Head class="px-4 py-3">สถานะ</Table.Head>
									<Table.Head class="w-10 px-3 py-3">
										<span class="sr-only">เปิดรายละเอียด</span>
									</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body class="divide-y divide-slate-100">
								{#each pageRows as row (row.item._id)}
									<MasterItemRow {row} onopen={openItem} />
								{/each}
							</Table.Body>
						</Table.Root>
					</div>

					<MasterPager bind:page={paging.page} count={filtered.length} perPage={MASTER_PAGE_SIZE} />
				{/if}
			{/if}
		</div>
	{/if}
</div>

{#if canWrite && view === 'items'}
	<div
		class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
	>
		<Button
			type="button"
			class="min-h-12 w-full gap-2 rounded-lg bg-[#0A2647] text-base font-semibold text-white hover:bg-[#051930]"
			onclick={openCreateItem}
		>
			<Plus class="h-4 w-4" aria-hidden="true" />
			เพิ่มสินค้า
		</Button>
	</div>
{/if}

<MasterItemSheet
	bind:open={sheetOpen}
	bind:mode={sheetMode}
	item={selectedItem}
	origin={selectedItem ? catalogOrigin(selectedItem, shelterCode) : 'central'}
	action={selectedItem ? itemActionKind(selectedItem) : 'none'}
	canEdit={selectedItem ? canEditItem(selectedItem) : false}
	categoryLabel={selectedItem ? categoryLabelOf(selectedItem) : ''}
	unitLines={selectedItem ? unitLines(selectedItem, formatCode) : []}
	{basePath}
	{defaultCategoryId}
	onaction={(kind) => selectedItem && requestItemAction(selectedItem, kind)}
	onactivate={() => selectedItem && activateItem(selectedItem)}
	onclose={() => {
		if (sheetMode === 'create') selectedId = '';
	}}
/>

<Dialog.Root bind:open={confirmOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{confirmTitle}</Dialog.Title>
			<Dialog.Description>{confirmBody}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" class="min-h-11" onclick={() => (confirmOpen = false)}>
				ยกเลิก
			</Button>
			<Button
				variant={pendingAction?.kind === 'reset' ? 'default' : 'destructive'}
				class="min-h-11"
				disabled={updateItemMutation.isPending || deleteItemMutation.isPending}
				onclick={confirmPendingAction}
			>
				{confirmButtonLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

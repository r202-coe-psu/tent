<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, isWarehouseStaff } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Search from '@lucide/svelte/icons/search';
	import Ban from '@lucide/svelte/icons/ban';
	import Power from '@lucide/svelte/icons/power';
	import {
		itemBelongsToCategory,
		catalogOrigin,
		canShelterDeleteCatalogDoc,
		type ItemCategory,
		type ItemMaster
	} from '../domain/catalog';
	import { formatUnit } from '../domain/unit-of-measure';
	import {
		useItemCategories,
		useItemMasters,
		useUnitsOfMeasure,
		useDeleteItemMaster,
		useUpdateItemMaster,
		useDeleteItemCategory
	} from '../application/queries';
	import ItemMasterForm from './item-master-form.svelte';
	import ItemCategoryForm from './item-category-form.svelte';
	import { langState } from '$lib/states/i18n.svelte';

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
	const deleteCategoryMutation = useDeleteItemCategory();

	const categories = $derived(categoriesQuery.data ?? []);
	const items = $derived(itemsQuery.data ?? []);
	const units = $derived(unitsQuery.data ?? []);

	let selectedCategoryId = $state<string | null>(null);
	let itemSearch = $state('');

	const effectiveCategoryId = $derived.by(() => {
		if (selectedCategoryId && categories.some((c) => c._id === selectedCategoryId)) {
			return selectedCategoryId;
		}
		return categories[0]?._id ?? null;
	});

	const selectedCategory = $derived(categories.find((c) => c._id === effectiveCategoryId) ?? null);

	function categoryCount(cat: ItemCategory): number {
		return items.filter((item) => itemBelongsToCategory(item, cat)).length;
	}

	const filteredItems = $derived.by(() => {
		if (!selectedCategory) return [];
		const needle = itemSearch.trim().toLowerCase();
		return items.filter((item) => {
			if (!itemBelongsToCategory(item, selectedCategory)) return false;
			if (!needle) return true;
			return item.name.toLowerCase().includes(needle);
		});
	});

	function originLabel(item: ItemMaster): string {
		const origin = catalogOrigin(item, shelterCode);
		if (origin === 'local') return 'เฉพาะศูนย์';
		if (origin === 'override') return 'ปรับแต่งแล้ว';
		return 'ส่วนกลาง';
	}

	function unitSentence(item: ItemMaster): string {
		const base = formatUnit(item.base_unit, units, langState.current);
		if (!item.conversions?.length) return base || '—';
		const parts = item.conversions
			.filter((c) => c.uom_name && c.multiplier)
			.map((c) => {
				const pack = formatUnit(c.uom_name, units, langState.current);
				return `1 ${pack} = ${c.multiplier} ${base}`;
			});
		return parts.length > 0 ? parts.join(' · ') : base || '—';
	}

	function statusLabel(item: ItemMaster): string {
		return item.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน';
	}

	// —— item sheet ——
	let itemSheetOpen = $state(false);
	let itemSheetMode = $state<'create' | 'edit'>('create');
	let editingItemId = $state('');

	function openCreateItem() {
		editingItemId = '';
		itemSheetMode = 'create';
		itemSheetOpen = true;
	}

	function openEditItem(id: string) {
		editingItemId = id;
		itemSheetMode = 'edit';
		itemSheetOpen = true;
	}

	function closeItemSheet() {
		itemSheetOpen = false;
		editingItemId = '';
	}

	// —— category sheet ——
	let categorySheetOpen = $state(false);
	let categorySheetMode = $state<'create' | 'edit'>('create');
	let editingCategoryId = $state('');

	function openCreateCategory() {
		editingCategoryId = '';
		categorySheetMode = 'create';
		categorySheetOpen = true;
	}

	function openEditCategory(cat: ItemCategory) {
		editingCategoryId = cat._id;
		categorySheetMode = 'edit';
		categorySheetOpen = true;
	}

	function closeCategorySheet() {
		categorySheetOpen = false;
		editingCategoryId = '';
	}

	function canEditCategory(cat: ItemCategory): boolean {
		if (scope === 'central') return isSA && !cat.shelter_code;
		return canWrite;
	}

	function canDeleteCategory(cat: ItemCategory): boolean {
		if (cat.is_protected) return false;
		if (scope === 'central') return isSA && !cat.shelter_code;
		if (!shelterCode) return false;
		return canWrite && canShelterDeleteCatalogDoc(cat, shelterCode);
	}

	// —— item actions ——
	function canEditItem(item: ItemMaster): boolean {
		if (scope === 'central') return isSA && !item.shelter_code;
		return canWrite;
	}

	function itemActionKind(item: ItemMaster): 'delete' | 'reset' | 'toggle' | 'none' {
		if (!canEditItem(item)) return 'none';
		if (scope === 'central') return 'toggle';
		const origin = catalogOrigin(item, shelterCode);
		if (origin === 'local') return 'delete';
		if (origin === 'override') return 'reset';
		return 'none';
	}

	let confirmOpen = $state(false);
	let pendingAction = $state<{
		kind: 'delete' | 'reset' | 'deactivate';
		item: ItemMaster;
	} | null>(null);

	function requestItemAction(item: ItemMaster, kind: 'delete' | 'reset' | 'deactivate') {
		pendingAction = { kind, item };
		confirmOpen = true;
	}

	function toggleItemActive(item: ItemMaster) {
		if (item.deactivated) {
			updateItemMutation.mutate(
				{ ...item, deactivated: false },
				{
					onSuccess: () => toast.success(`เปิดใช้งาน "${item.name}" สำเร็จ`),
					onError: (err: Error) => toast.error(err.message)
				}
			);
		} else {
			requestItemAction(item, 'deactivate');
		}
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
						confirmOpen = false;
						pendingAction = null;
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
					confirmOpen = false;
					pendingAction = null;
				},
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}

	let categoryDeleteOpen = $state(false);
	let pendingDeleteCategory = $state<ItemCategory | null>(null);

	function requestDeleteCategory(cat: ItemCategory) {
		pendingDeleteCategory = cat;
		categoryDeleteOpen = true;
	}

	function confirmDeleteCategory() {
		if (!pendingDeleteCategory) return;
		const cat = pendingDeleteCategory;
		deleteCategoryMutation.mutate(
			{ id: cat._id, shelterCode },
			{
				onSuccess: (result) => {
					if (result.actionTaken === 'reset') {
						toast.success(`คืนค่ามาตรฐานหมวด "${result.categoryName || cat.name}" สำเร็จ`);
					} else if (result.actionTaken === 'deactivate') {
						toast.success(`ปิดใช้งานหมวด "${result.categoryName || cat.name}" แล้ว`);
					} else {
						toast.success(`ลบหมวด "${result.categoryName || cat.name}" สำเร็จ`);
					}
					categoryDeleteOpen = false;
					pendingDeleteCategory = null;
					if (selectedCategoryId === cat._id) {
						selectedCategoryId = categories.find((c) => c._id !== cat._id)?._id ?? null;
					}
				},
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}

	const confirmTitle = $derived.by(() => {
		if (!pendingAction) return '';
		if (pendingAction.kind === 'reset') return 'คืนค่ามาตรฐาน';
		if (pendingAction.kind === 'deactivate') return 'ปิดใช้งานรายการ';
		return 'ลบรายการ';
	});

	const confirmBody = $derived.by(() => {
		if (!pendingAction) return '';
		const name = pendingAction.item.name;
		if (pendingAction.kind === 'reset') {
			return `ต้องการคืนค่ามาตรฐานของ "${name}" หรือไม่? การปรับแต่งของศูนย์จะถูกลบ`;
		}
		if (pendingAction.kind === 'deactivate') {
			return `ต้องการปิดใช้งาน "${name}" หรือไม่?`;
		}
		return `ต้องการลบ "${name}" หรือไม่?`;
	});
</script>

<div class="flex flex-col gap-4 lg:flex-row lg:items-start">
	<!-- Category rail -->
	<aside
		class="w-full shrink-0 rounded-xl border border-border bg-card p-3 lg:sticky lg:top-4 lg:w-64"
	>
		<div class="mb-3 flex items-center justify-between gap-2">
			<span class="text-sm font-semibold">หมวดสินค้า</span>
			{#if canWrite}
				<Button size="sm" variant="outline" class="h-8 gap-1 px-2" onclick={openCreateCategory}>
					<Plus class="h-3.5 w-3.5" />
					เพิ่ม
				</Button>
			{/if}
		</div>

		{#if categoriesQuery.isLoading}
			<p class="py-4 text-center text-xs text-muted-foreground">กำลังโหลด...</p>
		{:else if categories.length === 0}
			<p class="py-4 text-center text-xs text-muted-foreground">ยังไม่มีหมวดสินค้า</p>
		{:else}
			<ul class="flex max-h-64 flex-col gap-1 overflow-y-auto lg:max-h-[min(70vh,32rem)]">
				{#each categories as cat (cat._id)}
					{@const selected = effectiveCategoryId === cat._id}
					<li>
						<div
							class="flex items-center gap-1 rounded-lg pr-1 transition-colors {selected
								? 'bg-primary text-primary-foreground'
								: 'hover:bg-muted'}"
						>
							<button
								type="button"
								onclick={() => (selectedCategoryId = cat._id)}
								class="flex min-w-0 flex-1 items-center justify-between gap-2 py-2 pr-1 pl-3 text-left text-sm"
							>
								<span class="min-w-0 truncate font-medium">
									{cat.name}{cat.deactivated ? ' (ปิด)' : ''}
								</span>
								<span
									class="shrink-0 rounded-md px-1.5 py-0.5 text-xs tabular-nums {selected
										? 'bg-primary-foreground/20'
										: 'bg-muted-foreground/15'}"
								>
									{categoryCount(cat)}
								</span>
							</button>
							{#if canEditCategory(cat)}
								<Button
									size="icon-sm"
									variant="outline"
									class="shrink-0 cursor-pointer border-border bg-background text-foreground shadow-sm hover:bg-muted"
									title="แก้ไขหมวด"
									aria-label="แก้ไขหมวด {cat.name}"
									onclick={() => openEditCategory(cat)}
								>
									<Pencil class="size-3.5" />
								</Button>
							{/if}
							{#if selected && canDeleteCategory(cat)}
								<Button
									size="icon-sm"
									variant="outline"
									class="shrink-0 cursor-pointer border-border bg-background text-destructive shadow-sm hover:bg-destructive/10"
									title="ลบหมวด"
									aria-label="ลบหมวด {cat.name}"
									onclick={() => requestDeleteCategory(cat)}
								>
									<Trash2 class="size-3.5" />
								</Button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</aside>

	<!-- Items table -->
	<section class="min-w-0 flex-1 space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 class="text-base font-semibold">
					{selectedCategory?.name ?? 'รายการสินค้า'}
				</h2>
				<p class="text-xs text-muted-foreground">{filteredItems.length} รายการ</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<div class="relative min-w-[10rem] flex-1 sm:max-w-xs">
					<Search
						class="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input bind:value={itemSearch} placeholder="ค้นหาสินค้า..." class="h-9 pl-8" />
				</div>
				{#if canWrite && selectedCategory}
					<Button size="sm" class="gap-1" onclick={openCreateItem}>
						<Plus class="h-4 w-4" />
						เพิ่มสินค้า
					</Button>
				{/if}
			</div>
		</div>

		{#if itemsQuery.isLoading}
			<p class="py-10 text-center text-sm text-muted-foreground">กำลังโหลดรายการ...</p>
		{:else if filteredItems.length === 0}
			<p class="py-10 text-center text-sm text-muted-foreground">ไม่พบรายการในหมวดนี้</p>
		{:else}
			<div class="overflow-x-auto rounded-lg border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>ชื่อ</Table.Head>
							<Table.Head>หน่วย</Table.Head>
							<Table.Head>ที่มา</Table.Head>
							<Table.Head>สถานะ</Table.Head>
							<Table.Head class="text-right">จัดการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filteredItems as item (item._id)}
							{@const action = itemActionKind(item)}
							<Table.Row class={item.deactivated ? 'opacity-60' : ''}>
								<Table.Cell class="font-medium">{item.name}</Table.Cell>
								<Table.Cell class="max-w-[14rem] text-xs text-muted-foreground">
									{unitSentence(item)}
								</Table.Cell>
								<Table.Cell class="text-sm">{originLabel(item)}</Table.Cell>
								<Table.Cell class="text-sm">{statusLabel(item)}</Table.Cell>
								<Table.Cell>
									<div class="flex flex-wrap items-center justify-end gap-1">
										{#if canEditItem(item)}
											<Button
												size="icon-sm"
												variant="outline"
												class="cursor-pointer"
												title="แก้ไข"
												aria-label="แก้ไข {item.name}"
												onclick={() => openEditItem(item._id)}
											>
												<Pencil class="size-3.5" />
											</Button>
										{/if}
										{#if action === 'delete'}
											<Button
												size="icon-sm"
												variant="ghost"
												class="cursor-pointer text-destructive"
												title="ลบ"
												aria-label="ลบ {item.name}"
												onclick={() => requestItemAction(item, 'delete')}
											>
												<Trash2 class="size-3.5" />
											</Button>
										{:else if action === 'reset'}
											<Button
												size="sm"
												variant="ghost"
												class="h-8 cursor-pointer px-2 text-xs"
												onclick={() => requestItemAction(item, 'reset')}
											>
												คืนค่ามาตรฐาน
											</Button>
										{:else if action === 'toggle'}
											{#if item.deactivated}
												<Button
													size="icon-sm"
													variant="outline"
													class="cursor-pointer text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
													title="เปิดใช้งาน"
													aria-label="เปิดใช้งาน {item.name}"
													onclick={() => toggleItemActive(item)}
												>
													<Power class="size-3.5" />
												</Button>
											{:else}
												<Button
													size="icon-sm"
													variant="destructive"
													class="cursor-pointer bg-destructive text-white shadow-sm hover:bg-destructive/90"
													title="ปิดใช้งาน"
													aria-label="ปิดใช้งาน {item.name}"
													onclick={() => toggleItemActive(item)}
												>
													<Ban class="size-3.5" />
												</Button>
											{/if}
										{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</section>
</div>

<!-- Item sheet -->
<Sheet.Root bind:open={itemSheetOpen}>
	<Sheet.Content
		side="right"
		class="w-full overflow-y-auto sm:max-w-lg {categorySheetOpen ? 'sm:-translate-x-20' : ''}"
	>
		<Sheet.Header class="border-b border-border px-6 pt-4 pb-4 text-left">
			<Sheet.Title>
				{itemSheetMode === 'create' ? 'เพิ่มสินค้า' : 'แก้ไขสินค้า'}
			</Sheet.Title>
			<Sheet.Description>
				{selectedCategory?.name ?? 'รายการคลังสินค้า'}
			</Sheet.Description>
		</Sheet.Header>
		<div class="px-6 py-4">
			{#key `${itemSheetMode}-${editingItemId}-${selectedCategory?._id ?? ''}`}
				<ItemMasterForm
					id={editingItemId}
					isEdit={itemSheetMode === 'edit'}
					{basePath}
					compact={true}
					defaultCategoryId={selectedCategory?._id}
					onsuccess={closeItemSheet}
				/>
			{/key}
		</div>
	</Sheet.Content>
</Sheet.Root>

<!-- Category sheet -->
<Sheet.Root bind:open={categorySheetOpen}>
	<Sheet.Content side="right" class="w-full overflow-y-auto sm:max-w-sm">
		<Sheet.Header class="border-b border-border px-6 pt-4 pb-4 text-left">
			<Sheet.Title>
				{categorySheetMode === 'create' ? 'เพิ่มหมวดสินค้า' : 'แก้ไขหมวดสินค้า'}
			</Sheet.Title>
		</Sheet.Header>
		<div class="px-6 py-4">
			{#key `${categorySheetMode}-${editingCategoryId}`}
				<ItemCategoryForm
					id={editingCategoryId}
					isEdit={categorySheetMode === 'edit'}
					{basePath}
					onsuccess={closeCategorySheet}
				/>
			{/key}
		</div>
	</Sheet.Content>
</Sheet.Root>

<!-- Item confirm dialog -->
<Dialog.Root bind:open={confirmOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{confirmTitle}</Dialog.Title>
			<Dialog.Description>{confirmBody}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" onclick={() => (confirmOpen = false)}>ยกเลิก</Button>
			<Button
				variant={pendingAction?.kind === 'deactivate' ? 'default' : 'destructive'}
				onclick={confirmPendingAction}
			>
				ยืนยัน
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Category delete dialog -->
<Dialog.Root bind:open={categoryDeleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>ลบหมวดสินค้า</Dialog.Title>
			<Dialog.Description>
				ต้องการลบหมวด "{pendingDeleteCategory?.name}" หรือไม่?
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" onclick={() => (categoryDeleteOpen = false)}>ยกเลิก</Button>
			<Button variant="destructive" onclick={confirmDeleteCategory}>ยืนยัน</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

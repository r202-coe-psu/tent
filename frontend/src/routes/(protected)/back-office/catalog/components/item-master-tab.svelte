<script lang="ts">
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, isWarehouseStaff } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { SvelteMap } from 'svelte/reactivity';

	// Component
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	// Icon
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import Boxes from '@lucide/svelte/icons/boxes';
	import CircleCheckBig from '@lucide/svelte/icons/circle-check-big';
	import Leaf from '@lucide/svelte/icons/leaf';
	import Tag from '@lucide/svelte/icons/tag';
	import X from '@lucide/svelte/icons/x';
	// Navigation / Routing
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	// Feature
	import {
		useItemMasters,
		useItemCategories,
		ItemMasterForm,
		useDeleteItemMaster,
		useUpdateItemMaster,
		CatalogListToolbar,
		CatalogFormShell,
		CatalogScopeBadge,
		TypeClassBadge,
		categoryReferenceMatches,
		itemMasterUnit,
		type ItemMaster,
		type ItemCategory
	} from '$lib/features/catalog';

	let {
		basePath = '/back-office/catalog'
	}: {
		basePath?: string;
	} = $props();

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));

	const shelterCode = $derived(basePath.includes('system-management') ? null : getShelterCode());

	const canWrite = $derived(
		isSA ||
			(basePath.includes('back-office') && (isShelterManager(roles) || isWarehouseStaff(roles)))
	);

	function canModifyItem(item: ItemMaster) {
		if (basePath.includes('system-management')) {
			return isSA && !item.shelter_code;
		}
		return canWrite;
	}

	const query = useItemMasters(() => shelterCode);
	const categoriesQuery = useItemCategories(() => shelterCode);
	const deleteMutation = useDeleteItemMaster();
	const updateItemMutation = useUpdateItemMaster();

	const categoryById = $derived.by(() => {
		const map = new SvelteMap<string, ItemCategory>();
		for (const c of categoriesQuery.data ?? []) map.set(c._id, c);
		return map;
	});

	function categoryNameOf(item: ItemMaster): string {
		if (!item.category) return '—';
		const cats = categoriesQuery.data ?? [];
		const matched = cats.find((c) => categoryReferenceMatches(item.category!, c));
		return matched?.name ?? '—';
	}

	let deleteConfirmOpen = $state(false);
	let pendingDeleteItem = $state<{ id: string; name: string } | null>(null);

	function activateItem(item: ItemMaster) {
		const updated = { ...item, deactivated: false };
		updateItemMutation.mutate(updated, {
			onSuccess: () => {
				toast.success(`นำรายการ "${item.name}" กลับมาใช้งานสำเร็จ`);
			},
			onError: (err: Error) => {
				toast.error(err.message || 'เกิดข้อผิดพลาดในการทำรายการ');
			}
		});
	}

	function showDeleteConfirm(id: string, name: string) {
		pendingDeleteItem = { id, name };
		deleteConfirmOpen = true;
	}

	function confirmDelete() {
		if (!pendingDeleteItem) return;
		const { id, name } = pendingDeleteItem;
		deleteMutation.mutate(
			{ id, shelterCode },
			{
				onSuccess: (wasDeleted) => {
					if (wasDeleted) {
						toast.success(`ลบรายการ "${name}" สำเร็จ`);
					} else {
						toast.success(
							`เปลี่ยนสถานะรายการ "${name}" เป็นปิดใช้งาน (Deactivated) เนื่องจากรายการนี้มีการบันทึกธุรกรรมในคลังแล้ว`
						);
					}
					deleteConfirmOpen = false;
					pendingDeleteItem = null;
				},
				onError: (err: Error) => {
					toast.error(err.message || 'เกิดข้อผิดพลาดในการทำรายการ');
				}
			}
		);
	}

	// Pagination
	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let q = $state('');
	let categoryFilter = $state('ALL');

	// Data Queries
	const filteredAll = $derived.by(() => {
		let items = query.data ?? [];
		if (categoryFilter !== 'ALL') {
			const cat = categoryById.get(categoryFilter);
			items = cat
				? items.filter((i) => i.category && categoryReferenceMatches(i.category, cat))
				: [];
		}
		const needle = q.trim().toLowerCase();
		if (!needle) return items;
		return items.filter(
			(e) => e.name.toLowerCase().includes(needle) || (e.sku ?? '').toLowerCase().includes(needle)
		);
	});
	const total = $derived(filteredAll.length);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const safePage = $derived(Math.min(currentPage, totalPages));

	const paginatedItems = $derived.by(() => {
		const start = (safePage - 1) * PAGE_SIZE;
		return filteredAll.slice(start, start + PAGE_SIZE);
	});

	$effect(() => {
		void q;
		void categoryFilter;
		currentPage = 1;
	});

	// Form Page
	let viewMode = $state<'list' | 'create' | 'edit'>('list');
	let selectedId = $state<string | undefined>(undefined);

	$effect(() => {
		const action = page.url.searchParams.get('action');
		if (action === 'create') {
			viewMode = 'create';
		}
	});

	let appliedCategoryParam = $state<string | null>(null);
	$effect(() => {
		const p = page.url.searchParams.get('category');
		if (p && p !== appliedCategoryParam) {
			appliedCategoryParam = p;
			categoryFilter = p;
		}
	});

	function clearCategoryFilter() {
		categoryFilter = 'ALL';
		appliedCategoryParam = null;
		const url = new URL(page.url);
		url.searchParams.delete('category');
		goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function showCreateForm() {
		selectedId = undefined;
		viewMode = 'create';
	}

	function showEditForm(id: string) {
		selectedId = id;
		viewMode = 'edit';
	}

	function backToList() {
		viewMode = 'list';
		selectedId = undefined;
		const suffix =
			categoryFilter !== 'ALL' ? `&category=${encodeURIComponent(categoryFilter)}` : '';
		goto(
			resolve(`${basePath}?tab=item_master` as '/back-office/catalog?tab=item_master') + suffix,
			{ replaceState: true }
		);
	}
</script>

{#if viewMode === 'list'}
	<div class="flex w-full flex-col gap-4">
		<CatalogListToolbar {total} bind:search={q} {canWrite} onadd={showCreateForm}>
			{#snippet filters()}
				<Select.Root type="single" bind:value={categoryFilter}>
					<Select.Trigger class="h-11 w-full sm:h-10 sm:w-64" aria-label="กรองตามหมวดหมู่">
						{categoryFilter === 'ALL'
							? 'ทุกหมวดหมู่ (All Categories)'
							: (categoryById.get(categoryFilter)?.name ?? '—')}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="ALL" label="ทุกหมวดหมู่ (All Categories)">
							ทุกหมวดหมู่ (All Categories)
						</Select.Item>
						{#each categoriesQuery.data ?? [] as c (c._id)}
							<Select.Item value={c._id} label={c.name}>{c.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/snippet}
		</CatalogListToolbar>

		{#if categoryFilter !== 'ALL'}
			<div
				class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm dark:border-teal-900/40 dark:bg-teal-950/20"
			>
				<span class="flex flex-wrap items-center gap-1.5">
					<Tag class="size-4 text-teal-700 dark:text-teal-400" />
					<span class="font-semibold text-teal-900 dark:text-teal-300">
						{categoryById.get(categoryFilter)?.name ?? categoryFilter}
					</span>
					<span class="text-teal-700 dark:text-teal-400">
						(พบ <span class="tabular-nums">{total}</span> รายการสิ่งของ)
					</span>
				</span>
				<button
					type="button"
					onclick={clearCategoryFilter}
					class="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:text-teal-300 dark:hover:bg-teal-900/40"
				>
					<X class="size-3.5" />
					ล้างตัวกรองหมวดหมู่
				</button>
			</div>
		{/if}

		<!-- Table -->
		<div class="overflow-x-auto rounded-xl border border-border bg-card">
			<Table.Root class="min-w-[880px]">
				<Table.Header>
					<Table.Row>
						<Table.Head class="hidden font-bold md:table-cell">รหัส SKU</Table.Head>
						<Table.Head class="font-bold">ชื่อสินค้าทางการ</Table.Head>
						<Table.Head class="font-bold">หมวดหมู่</Table.Head>
						<Table.Head class="font-bold">ประเภท (CLASS)</Table.Head>
						<Table.Head class="hidden font-bold lg:table-cell">หน่วยนับ</Table.Head>
						<Table.Head class="hidden font-bold lg:table-cell">สถานะโภชนาการ</Table.Head>
						<Table.Head class="text-center font-bold whitespace-nowrap">จัดการ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if query.isLoading}
						<Table.Row>
							<Table.Cell colspan={7} class="py-6 text-center text-muted-foreground"
								>กำลังโหลดข้อมูล...</Table.Cell
							>
						</Table.Row>
					{:else if filteredAll.length === 0}
						<Table.Row>
							<Table.Cell colspan={7} class="py-10 text-center text-muted-foreground">
								<div class="flex flex-col items-center gap-2">
									<PackageOpen class="size-8 text-slate-300" />
									ไม่พบข้อมูลมาสเตอร์ที่ค้นหาตามเงื่อนไขนี้
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each paginatedItems as e (e._id)}
							<Table.Row>
								<Table.Cell
									class="hidden tracking-wider text-muted-foreground uppercase md:table-cell"
								>
									{e.sku || '—'}
								</Table.Cell>
								<Table.Cell class="font-bold text-foreground">
									<div class="flex flex-wrap items-center gap-2">
										{e.name}
										<CatalogScopeBadge doc={e} />
									</div>
									<p class="mt-0.5 text-xs text-muted-foreground md:hidden">
										{e.sku || '—'} · {categoryNameOf(e)} · {itemMasterUnit(e)}
									</p>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">{categoryNameOf(e)}</Table.Cell>
								<Table.Cell><TypeClassBadge value={e.type_class} variant="compact" /></Table.Cell>
								<Table.Cell class="hidden text-muted-foreground lg:table-cell"
									>{itemMasterUnit(e)}</Table.Cell
								>
								<Table.Cell class="hidden lg:table-cell">
									{#if e.dietary && e.dietary.length > 0}
										<div class="flex flex-wrap gap-1.5">
											{#if e.dietary.includes('HALAL')}
												<span
													class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
												>
													<CircleCheckBig class="size-3.5" />
													ฮาลาล
												</span>
											{/if}
											{#if e.dietary.includes('VEGAN')}
												<span
													class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
												>
													<Leaf class="size-3.5" />
													วีแกน
												</span>
											{/if}
										</div>
									{:else}
										<span class="text-muted-foreground" aria-label="ไม่ระบุ">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-center">
									{#if canModifyItem(e)}
										<div class="inline-flex flex-nowrap justify-center gap-2">
											<Button
												variant="outline"
												size="sm"
												onclick={() => showEditForm(e._id)}
												class="min-h-11 border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/20"
											>
												<Settings2 class="h-4 w-4" />
												จัดการ
											</Button>
											{#if (e.shelter_code || undefined) === (shelterCode || undefined)}
												{#if e.deactivated}
													<Button
														variant="outline"
														size="sm"
														onclick={() => activateItem(e)}
														disabled={updateItemMutation.isPending}
														class="min-h-11 border-green-200 text-green-600 hover:bg-green-50 hover:text-green-700 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/20"
													>
														<RotateCcw class="h-4 w-4" />
														นำกลับมาใช้
													</Button>
												{:else}
													<Button
														variant="outline"
														size="sm"
														onclick={() => showDeleteConfirm(e._id, e.name)}
														disabled={deleteMutation.isPending}
														class="min-h-11 {e.override
															? 'border-orange-200 text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950/20'
															: 'border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20'}"
													>
														<Trash2 class="h-4 w-4" />
														{e.override ? 'รีเซ็ต' : 'ลบ'}
													</Button>
												{/if}
											{/if}
										</div>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</div>

		{#if totalPages > 1}
			<div class="mt-4 flex justify-end">
				<Pagination.Root bind:page={currentPage} count={total} perPage={PAGE_SIZE}>
					{#snippet children({ pages })}
						<Pagination.Content>
							<Pagination.Previous />
							{#each pages as p, i (i)}
								<Pagination.Item>
									{#if p.type === 'page'}
										<Pagination.Link page={p} isActive={p.value === safePage} />
									{:else}
										<Pagination.Ellipsis />
									{/if}
								</Pagination.Item>
							{/each}
							<Pagination.Next />
						</Pagination.Content>
					{/snippet}
				</Pagination.Root>
			</div>
		{/if}
	</div>
{:else}
	<CatalogFormShell
		title={viewMode === 'edit'
			? 'แก้ไขรายการสิ่งของ (Item Master)'
			: 'เพิ่มรายการสิ่งของ (Item Master)'}
		icon={Boxes}
		{canWrite}
		onclose={backToList}
	>
		<ItemMasterForm
			id={selectedId}
			isEdit={viewMode === 'edit'}
			{basePath}
			onsuccess={backToList}
			oncancel={backToList}
		/>
	</CatalogFormShell>
{/if}

<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[420px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-red-600">
				{#if pendingDeleteItem && filteredAll.find((i) => i._id === pendingDeleteItem?.id)?.override}
					ยืนยันการคืนค่ามาตรฐาน
				{:else}
					ยืนยันการลบรายการสิ่งของ
				{/if}
			</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-500">
				{#if pendingDeleteItem}
					{@const pendingItem = filteredAll.find((i) => i._id === pendingDeleteItem?.id)}
					{#if pendingItem?.override}
						คุณแน่ใจหรือไม่ว่าต้องการรีเซ็ตรายการ <strong class="text-slate-900"
							>{pendingDeleteItem.name}</strong
						>
						กลับเป็นค่ามาตรฐานส่วนกลาง?
						<span class="mt-3 block text-xs leading-relaxed text-muted-foreground">
							* ข้อมูลที่ศูนย์นี้ทำการปรับแต่งไว้จะถูกลบออกทั้งหมด
							และจะกลับไปใช้ค่าเริ่มต้นจากส่วนกลางแทน
						</span>
					{:else}
						คุณแน่ใจหรือไม่ว่าต้องการลบรายการ <strong class="text-slate-900"
							>{pendingDeleteItem.name}</strong
						>?
						<span class="mt-3 block text-xs leading-relaxed text-muted-foreground">
							* หากรายการนี้มีประวัติการบันทึกคลังสินค้า (Stock Ledger) อยู่ในระบบแล้ว
							รายการจะถูกเปลี่ยนสถานะเป็นปิดใช้งาน (Deactivated) แทนการลบถาวร
						</span>
					{/if}
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-2 flex justify-end gap-4 pt-4">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					deleteConfirmOpen = false;
					pendingDeleteItem = null;
				}}
				class="rounded-lg"
			>
				ยกเลิก
			</Button>
			<Button
				variant="destructive"
				disabled={deleteMutation.isPending}
				onclick={confirmDelete}
				class="rounded-lg bg-red-600 text-white hover:bg-red-700"
			>
				{#if deleteMutation.isPending}
					กำลังดำเนินการ...
				{:else if pendingDeleteItem && filteredAll.find((i) => i._id === pendingDeleteItem?.id)?.override}
					ยืนยันการคืนค่า
				{:else}
					ยืนยันการลบ
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

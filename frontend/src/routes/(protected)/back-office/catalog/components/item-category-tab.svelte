<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, isWarehouseStaff } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { goto } from '$app/navigation';
	// Component
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';

	// Icon
	import Package from '@lucide/svelte/icons/package';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import Wrench from '@lucide/svelte/icons/wrench';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	// Feature
	import {
		useItemCategories,
		ItemCategoryForm,
		useDeleteItemCategory,
		useUpdateItemCategory,
		useItemMasters,
		CatalogListToolbar,
		CatalogFormShell,
		CatalogScopeBadge,
		TypeClassBadge,
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

	function canModifyCategory(cat: ItemCategory) {
		if (basePath.includes('system-management')) {
			return isSA && !cat.shelter_code;
		}
		return canWrite;
	}

	const query = useItemCategories(() => shelterCode);
	const deleteMutation = useDeleteItemCategory();
	const updateCategoryMutation = useUpdateItemCategory();
	const itemMastersQuery = useItemMasters(() => shelterCode);

	const itemCounts = $derived.by(() => {
		const masters = itemMastersQuery.data ?? [];
		const categories = query.data ?? [];
		const counts: Record<string, number> = {};
		for (const cat of categories) {
			counts[cat._id] = 0;
		}
		for (const item of masters) {
			if (!item.category) continue;
			for (const cat of categories) {
				if (
					item.category === cat._id ||
					item.category === cat.name ||
					(cat.system_key && item.category.toUpperCase() === cat.system_key.toUpperCase())
				) {
					counts[cat._id] = (counts[cat._id] || 0) + 1;
				}
			}
		}
		return counts;
	});

	let deleteConfirmOpen = $state(false);
	let pendingDeleteCategory = $state<{ id: string; name: string } | null>(null);

	function activateCategory(cat: ItemCategory) {
		const updated = { ...cat, deactivated: false };
		updateCategoryMutation.mutate(updated, {
			onSuccess: () => {
				toast.success(`นำหมวดหมู่ "${cat.name}" กลับมาใช้งานสำเร็จ`);
			},
			onError: (err: Error) => {
				toast.error(err.message || 'เกิดข้อผิดพลาดในการทำรายการ');
			}
		});
	}

	function showDeleteConfirm(id: string, name: string) {
		pendingDeleteCategory = { id, name };
		deleteConfirmOpen = true;
	}

	function confirmDelete() {
		if (!pendingDeleteCategory) return;
		const { id, name } = pendingDeleteCategory;
		deleteMutation.mutate(
			{ id, shelterCode },
			{
				onSuccess: (result) => {
					if (result.actionTaken === 'reset') {
						toast.success(`คืนค่ามาตรฐานหมวดหมู่ "${result.categoryName || name}" สำเร็จ`);
					} else if (result.actionTaken === 'deactivate') {
						toast.info(
							`เปลี่ยนสถานะหมวดหมู่ "${result.categoryName || name}" เป็นปิดการใช้งาน (Deactivated) แล้ว`
						);
					} else {
						toast.success(`ลบหมวดหมู่ "${result.categoryName || name}" ถาวรสำเร็จ`);
					}
					deleteConfirmOpen = false;
					pendingDeleteCategory = null;
				},
				onError: (err) => {
					toast.error(err.message || 'เกิดข้อผิดพลาดในการลบหมวดหมู่');
				}
			}
		);
	}

	// Pagination
	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let q = $state('');

	// Data Queries
	// const query = useItemCategoriesPaginated(
	// 	() => currentPage,
	// 	() => PAGE_SIZE
	// );

	const filteredAll = $derived.by(() => {
		const items = query.data ?? [];
		const needle = q.trim().toLowerCase();
		if (!needle) return items;
		return items.filter(
			(e) =>
				e.name.toLowerCase().includes(needle) ||
				(e.system_key ?? '').toLowerCase().includes(needle) ||
				(e.description ?? '').toLowerCase().includes(needle)
		);
	});
	const total = $derived(filteredAll.length);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

	const paginatedItems = $derived.by(() => {
		const start = (currentPage - 1) * PAGE_SIZE;
		return filteredAll.slice(start, start + PAGE_SIZE);
	});

	$effect(() => {
		if (q) currentPage = 1;
	});

	// Form Page
	let viewMode = $state<'list' | 'create' | 'edit'>('list');
	let selectedId = $state<string | undefined>(undefined);

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
	}
</script>

{#if viewMode === 'list'}
	<div class="flex w-full flex-col gap-4">
		<CatalogListToolbar {total} bind:search={q} {canWrite} onadd={showCreateForm} />

		<!-- List -->
		<div class="overflow-x-auto rounded-xl border border-border bg-card">
			<div
				class="hidden items-center gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-sm font-semibold text-slate-900 sm:grid sm:grid-cols-[1fr_160px_220px] dark:text-slate-100"
			>
				<span>ชื่อข้อมูลมาตรฐาน</span>
				<span class="text-center">จำนวนรายการสิ่งของ</span>
				<span class="text-right">จัดการ</span>
			</div>
			{#if query.isLoading}
				<div class="py-6 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูล...</div>
			{:else if filteredAll.length === 0}
				<div
					class="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground"
				>
					<PackageOpen class="size-8 text-slate-300" />
					ไม่พบข้อมูลมาสเตอร์ที่ค้นหาตามเงื่อนไขนี้
				</div>
			{:else}
				<ul class="divide-y divide-border">
					{#each paginatedItems as e (e._id)}
						{@const count = itemCounts[e._id] || 0}
						<li
							class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_160px_220px] sm:items-start sm:gap-4"
						>
							<div class="min-w-0 space-y-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-base font-bold text-foreground">{e.name}</span>
									<CatalogScopeBadge doc={e} />
									{#if e.default_class}
										<TypeClassBadge value={e.default_class} variant="compact" />
									{/if}
								</div>
								{#if e.system_key}
									<p class="text-sm text-muted-foreground">
										รหัสระบบ ·
										<span class="font-semibold tracking-wider text-foreground uppercase"
											>{e.system_key}</span
										>
									</p>
								{/if}
								{#if e.description}
									<p class="text-sm text-muted-foreground">{e.description}</p>
								{/if}
							</div>

							<div class="flex items-start justify-start sm:justify-center">
								{#if count > 0}
									<button
										type="button"
										onclick={() =>
											goto(`${basePath}?tab=item_master&category=${encodeURIComponent(e._id)}`)}
										aria-label="ดูรายการสิ่งของในหมวด {e.name} จำนวน {count} รายการ"
										class="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-900 hover:bg-teal-100 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-teal-900/40 dark:bg-teal-950/40 dark:text-teal-300"
									>
										<Package class="size-4" />
										<span class="tabular-nums">{count}</span> รายการ
										<ArrowRight class="size-3.5" />
									</button>
								{:else}
									<span class="badge-muted">0 รายการ</span>
								{/if}
							</div>

							<div class="flex flex-wrap items-start gap-2 sm:justify-end">
								{#if canModifyCategory(e)}
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
												onclick={() => activateCategory(e)}
												disabled={updateCategoryMutation.isPending}
												class="min-h-11 border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/20"
											>
												<RotateCcw class="h-4 w-4" />
												นำกลับมาใช้
											</Button>
										{:else}
											<Button
												variant="outline"
												size="sm"
												disabled={e.is_protected || deleteMutation.isPending}
												title={e.is_protected ? 'หมวดหมู่ระบบมาตรฐาน ลบไม่ได้' : undefined}
												onclick={() => showDeleteConfirm(e._id, e.name)}
												class="min-h-11 {e.override
													? 'border-orange-200 text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950/20'
													: 'border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20'}"
											>
												<Trash2 class="h-4 w-4" />
												{e.override ? 'รีเซ็ต' : 'ลบ'}
												{#if e.is_protected}<span class="sr-only"
														>(หมวดหมู่ระบบมาตรฐาน ลบไม่ได้)</span
													>{/if}
											</Button>
										{/if}
									{/if}
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
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
										<Pagination.Link page={p} isActive={p.value === currentPage} />
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
			? 'แก้ไขหมวดหมู่สิ่งของ (Item Category)'
			: 'เพิ่มหมวดหมู่สิ่งของ (Item Category)'}
		icon={Wrench}
		{canWrite}
		onclose={backToList}
	>
		<ItemCategoryForm
			id={selectedId}
			isEdit={viewMode === 'edit'}
			{basePath}
			onsuccess={backToList}
			oncancel={backToList}
		/>
	</CatalogFormShell>
{/if}

<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-red-600">
				{#if pendingDeleteCategory && filteredAll.find((i) => i._id === pendingDeleteCategory?.id)?.override}
					ยืนยันการคืนค่ามาตรฐาน
				{:else}
					ยืนยันการลบหมวดหมู่
				{/if}
			</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-500">
				{#if pendingDeleteCategory}
					{@const pendingItem = filteredAll.find((i) => i._id === pendingDeleteCategory?.id)}
					{#if pendingItem?.override}
						คุณแน่ใจหรือไม่ว่าต้องการรีเซ็ตหมวดหมู่ <strong class="text-slate-900"
							>{pendingDeleteCategory.name}</strong
						>
						กลับเป็นค่ามาตรฐานส่วนกลาง?
						<span class="mt-3 block text-xs leading-relaxed text-muted-foreground">
							* ข้อมูลที่ศูนย์นี้ทำการปรับแต่งไว้จะถูกลบออกทั้งหมด
							และจะกลับไปใช้ค่าเริ่มต้นจากส่วนกลางแทน
						</span>
					{:else}
						คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ <strong class="text-slate-900"
							>{pendingDeleteCategory.name}</strong
						>?
						<span class="mt-3 block text-xs leading-relaxed text-muted-foreground">
							* หากหมวดหมู่นี้มีสินค้าใช้งานอยู่ หรือเป็นหมวดหมู่ส่วนกลาง
							ระบบจะเปลี่ยนสถานะเป็นปิดการใช้งาน (Deactivated) แทนการลบถาวร
							เพื่อไม่ให้กระทบต่อประวัติสิ่งของ
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
					pendingDeleteCategory = null;
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
				{:else if pendingDeleteCategory && filteredAll.find((i) => i._id === pendingDeleteCategory?.id)?.override}
					ยืนยันการคืนค่า
				{:else}
					ยืนยันการลบ
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

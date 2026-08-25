<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin } from '$lib/auth/roles';
	// Component
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	// Icon
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Settings2 } from '@lucide/svelte';
	import { Trash2 } from '@lucide/svelte';
	// Feature
	import {
		useItemCategories,
		ItemCategoryForm,
		useDeleteItemCategory,
		useItemMasters
	} from '$lib/features/catalog';

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));

	const query = useItemCategories();
	const deleteMutation = useDeleteItemCategory();
	const itemMastersQuery = useItemMasters();

	const itemCounts = $derived.by(() => {
		const masters = itemMastersQuery.data ?? [];
		const counts: Record<string, number> = {};
		for (const item of masters) {
			if (item.category) {
				counts[item.category] = (counts[item.category] || 0) + 1;
			}
		}
		return counts;
	});

	let deleteConfirmOpen = $state(false);
	let pendingDeleteCategory = $state<{ id: string; name: string } | null>(null);

	function showDeleteConfirm(id: string, name: string) {
		pendingDeleteCategory = { id, name };
		deleteConfirmOpen = true;
	}

	function confirmDelete() {
		if (!pendingDeleteCategory) return;
		const { id, name } = pendingDeleteCategory;
		deleteMutation.mutate(id, {
			onSuccess: () => {
				toast.success(`ลบหมวดหมู่ "${name}" สำเร็จ`);
				deleteConfirmOpen = false;
				pendingDeleteCategory = null;
			},
			onError: (err) => {
				toast.error(err.message || 'เกิดข้อผิดพลาดในการลบหมวดหมู่');
			}
		});
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
		return items.filter((e) => e.name.toLowerCase().includes(needle));
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
		<div class="flex items-center justify-between gap-4">
			<span class="text-md font-bold">รายการข้อมูล ({total})</span>
			<div class="item-center flex gap-2">
				<div class="relative w-72">
					<Search class="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
					<Input bind:value={q} type="search" placeholder="ค้นหา..." class="pl-9" />
				</div>
				{#if isSA}
					<Button size="lg" class="flex items-center gap-2" onclick={showCreateForm}>
						<Plus class="h-4 w-4" />
						เพิ่มข้อมูล
					</Button>
				{/if}
			</div>
		</div>

		<!-- Table -->
		<div class="overflow-x-auto rounded-xl border border-border bg-card">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="font-bold">ชื่อข้อมูลมาตรฐาน</Table.Head>
						<Table.Head class="font-bold">จำนวนรายการสิ่งของ</Table.Head>
						<Table.Head class="w-24 text-center font-bold">จัดการ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if query.isLoading}
						<Table.Row>
							<Table.Cell colspan={3} class="py-6 text-center text-muted-foreground"
								>กำลังโหลดข้อมูล...</Table.Cell
							>
						</Table.Row>
					{:else if filteredAll.length === 0}
						<Table.Row>
							<Table.Cell colspan={3} class="py-6 text-center text-muted-foreground"
								>📭 ไม่พบข้อมูลมาสเตอร์ที่ค้นหาตามเงื่อนไขนี้</Table.Cell
							>
						</Table.Row>
					{:else}
						{#each paginatedItems as e (e._id)}
							<Table.Row>
								<Table.Cell class="font-bold text-foreground">{e.name}</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{itemCounts[e.name] || 0} รายการ
								</Table.Cell>
								<Table.Cell class="text-center">
									{#if isSA}
										<div class="inline-flex gap-2">
											<Button variant="outline" size="sm" onclick={() => showEditForm(e._id)}>
												<Settings2 class="h-4 w-4" />
												จัดการ
											</Button>
											<Button
												variant="outline"
												size="sm"
												onclick={() => showDeleteConfirm(e._id, e.name)}
												disabled={deleteMutation.isPending}
											>
												<Trash2 class="h-4 w-4" />
												ลบ
											</Button>
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
	<div
		class="w-full rounded-2xl border border-slate-100 bg-card p-6 shadow-sm md:p-8 dark:border-zinc-800"
	>
		<div class="flex items-start justify-between gap-4">
			<div class="flex flex-col gap-1.5">
				<span
					class="text-[11px] font-semibold tracking-wider text-[#002f6c] uppercase dark:text-blue-400"
				>
					ฐานข้อมูลมาสเตอร์ส่วนกลาง (MASTER DATA ENGINE)
				</span>

				<h1 class="text-xl leading-tight font-bold text-slate-800 md:text-2xl dark:text-slate-100">
					➕ บันทึกข้อมูลตั้งค่ามาตรฐานใหม่
				</h1>
			</div>

			<div class="flex items-center">
				<button onclick={backToList} class="rounded-lg p-2 transition hover:bg-muted/50">
					<X class="h-5 w-5 text-muted-foreground" />
				</button>
			</div>
		</div>
		<Separator class="my-4 bg-slate-100 dark:bg-zinc-800" />
		{#if isSA}
			<ItemCategoryForm id={selectedId} isEdit={viewMode === 'edit'} onsuccess={backToList} />
		{:else}
			<div class="py-12 text-center text-sm font-bold text-destructive">
				คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (Unauthorized)
			</div>
		{/if}
	</div>
{/if}

<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-red-600">ยืนยันการลบหมวดหมู่</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-500">
				{#if pendingDeleteCategory}
					คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ <strong class="text-slate-900"
						>{pendingDeleteCategory.name}</strong
					>?
					<span class="mt-3 block text-xs leading-relaxed text-muted-foreground">
						* ไม่สามารถลบหมวดหมู่ที่มีรายการสินค้าอ้างอิงอยู่ได้
					</span>
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
				{#if deleteMutation.isPending}กำลังลบ...{:else}ยืนยันการลบ{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

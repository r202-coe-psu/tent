<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Lock from '@lucide/svelte/icons/lock';
	import {
		canShelterDeleteCatalogDoc,
		catalogOrigin,
		type ItemCategory,
		type ItemMaster
	} from '../../domain/catalog';
	import { useDeleteItemCategory } from '../../application/queries';
	import ItemCategoryForm from '../item-category-form.svelte';
	import MasterBadge from './master-badge.svelte';
	import { categoryItemCount, ORIGIN_LABELS, ORIGIN_TONES } from './master-view';

	let {
		categories,
		items,
		isLoading,
		scope,
		basePath,
		shelterCode,
		isSA,
		canWrite
	}: {
		categories: readonly ItemCategory[];
		items: readonly ItemMaster[];
		isLoading: boolean;
		scope: 'central' | 'shelter';
		basePath: string;
		shelterCode: string | null;
		isSA: boolean;
		canWrite: boolean;
	} = $props();

	const deleteCategoryMutation = useDeleteItemCategory();

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

	let sheetOpen = $state(false);
	let sheetMode = $state<'create' | 'edit'>('create');
	let editingId = $state('');

	function openCreate() {
		editingId = '';
		sheetMode = 'create';
		sheetOpen = true;
	}

	function openEdit(cat: ItemCategory) {
		editingId = cat._id;
		sheetMode = 'edit';
		sheetOpen = true;
	}

	function closeSheet() {
		sheetOpen = false;
		editingId = '';
	}

	let deleteOpen = $state(false);
	let pendingDelete = $state<ItemCategory | null>(null);

	function requestDelete(cat: ItemCategory) {
		pendingDelete = cat;
		deleteOpen = true;
	}

	function confirmDelete() {
		if (!pendingDelete) return;
		const cat = pendingDelete;
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
					deleteOpen = false;
					pendingDelete = null;
				},
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}
</script>

<div class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
	<div
		class="flex flex-col gap-3 border-b border-slate-200/80 p-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<p class="text-sm text-slate-600">
			หมวดที่ใช้จัดกลุ่มสินค้า และกรองในหน้ารายการ · <span class="tabular-nums">
				{categories.length}
			</span> หมวด
		</p>
		{#if canWrite}
			<Button
				type="button"
				class="min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930]"
				onclick={openCreate}
			>
				<Plus class="h-4 w-4" aria-hidden="true" />
				เพิ่มหมวด
			</Button>
		{/if}
	</div>

	{#if isLoading}
		<div class="space-y-3 p-4">
			{#each [0, 1, 2] as i (i)}
				<div class="h-14 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"></div>
			{/each}
		</div>
	{:else if categories.length === 0}
		<p class="p-12 text-center text-sm font-medium text-slate-500">ยังไม่มีหมวดสินค้า</p>
	{:else}
		<!-- Phone cards -->
		<ul class="space-y-2.5 p-3 md:hidden">
			{#each categories as cat (cat._id)}
				<li
					class="rounded-xl border border-slate-200/80 bg-white p-3.5 {cat.deactivated
						? 'opacity-70'
						: ''}"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<p class="text-base font-semibold text-slate-900">{cat.name}</p>
							<p class="mt-0.5 text-sm text-slate-500 tabular-nums">
								{categoryItemCount(items, cat, false)} สินค้า
							</p>
						</div>
						<MasterBadge tone={ORIGIN_TONES[catalogOrigin(cat, shelterCode)]}>
							{ORIGIN_LABELS[catalogOrigin(cat, shelterCode)]}
						</MasterBadge>
					</div>
					<div class="mt-3 flex flex-wrap gap-2">
						{#if canEditCategory(cat)}
							<Button
								type="button"
								variant="outline"
								class="min-h-11 rounded-lg border-slate-300 text-sm font-semibold"
								onclick={() => openEdit(cat)}
							>
								แก้ไข
							</Button>
						{/if}
						{#if cat.is_protected}
							<MasterBadge tone="slate"
								><Lock class="h-3 w-3" aria-hidden="true" />ของระบบ</MasterBadge
							>
						{:else if canDeleteCategory(cat)}
							<Button
								type="button"
								variant="outline"
								class="min-h-11 rounded-lg border-red-200 text-sm font-semibold text-red-800"
								onclick={() => requestDelete(cat)}
							>
								ลบ
							</Button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<!-- Table (md+) -->
		<div class="hidden overflow-x-auto md:block">
			<Table.Root class="text-sm">
				<Table.Header class="border-b border-slate-200/80 bg-slate-50">
					<Table.Row class="text-xs font-semibold text-slate-600">
						<Table.Head class="px-4 py-3">หมวด</Table.Head>
						<Table.Head class="px-4 py-3 text-right">จำนวนสินค้า</Table.Head>
						<Table.Head class="px-4 py-3">ที่มา</Table.Head>
						<Table.Head class="px-4 py-3">สถานะ</Table.Head>
						<Table.Head class="px-4 py-3 text-right">จัดการ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body class="divide-y divide-slate-100">
					{#each categories as cat (cat._id)}
						<Table.Row class={cat.deactivated ? 'opacity-70' : ''}>
							<Table.Cell class="px-4 py-3 text-base font-semibold text-slate-900">
								{cat.name}
							</Table.Cell>
							<Table.Cell class="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">
								{categoryItemCount(items, cat, false)}
							</Table.Cell>
							<Table.Cell class="px-4 py-3">
								<MasterBadge tone={ORIGIN_TONES[catalogOrigin(cat, shelterCode)]}>
									{ORIGIN_LABELS[catalogOrigin(cat, shelterCode)]}
								</MasterBadge>
							</Table.Cell>
							<Table.Cell class="px-4 py-3">
								<MasterBadge tone={cat.deactivated ? 'red' : 'green'}>
									{cat.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน'}
								</MasterBadge>
							</Table.Cell>
							<Table.Cell class="px-4 py-2 text-right">
								<div class="flex items-center justify-end gap-2">
									{#if canEditCategory(cat)}
										<Button
											type="button"
											variant="outline"
											class="min-h-11 rounded-lg border-slate-300 text-sm font-semibold"
											onclick={() => openEdit(cat)}
										>
											แก้ไข
										</Button>
									{/if}
									{#if cat.is_protected}
										<MasterBadge tone="slate">
											<Lock class="h-3 w-3" aria-hidden="true" />ของระบบ
										</MasterBadge>
									{:else if canDeleteCategory(cat)}
										<Button
											type="button"
											variant="outline"
											class="min-h-11 rounded-lg border-red-200 text-sm font-semibold text-red-800"
											onclick={() => requestDelete(cat)}
										>
											ลบ
										</Button>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>

<p class="mt-3 text-sm text-slate-500">
	หมวดของระบบลบไม่ได้ · หมวดของศูนย์ที่ยังมีสินค้าอยู่จะถูกปิดใช้งานแทนการลบ
</p>

<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content
		side="right"
		class="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-none md:w-[28rem] md:border-l"
	>
		<Sheet.Header class="shrink-0 border-b border-slate-200/80 p-4 pr-12 text-left">
			<Sheet.Title class="text-xl font-bold text-slate-900">
				{sheetMode === 'create' ? 'เพิ่มหมวดสินค้า' : 'แก้ไขหมวดสินค้า'}
			</Sheet.Title>
			<Sheet.Description class="sr-only">กรอกชื่อหมวดและสถานะการใช้งาน</Sheet.Description>
		</Sheet.Header>
		<div class="min-h-0 flex-1 overflow-y-auto p-4">
			{#key `${sheetMode}-${editingId}`}
				<ItemCategoryForm
					id={editingId}
					isEdit={sheetMode === 'edit'}
					{basePath}
					onsuccess={closeSheet}
				/>
			{/key}
		</div>
	</Sheet.Content>
</Sheet.Root>

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>ลบหมวดสินค้า</Dialog.Title>
			<Dialog.Description>ต้องการลบหมวด "{pendingDelete?.name}" หรือไม่?</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" class="min-h-11" onclick={() => (deleteOpen = false)}>ยกเลิก</Button
			>
			<Button
				variant="destructive"
				class="min-h-11"
				disabled={deleteCategoryMutation.isPending}
				onclick={confirmDelete}
			>
				ยืนยัน
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, isWarehouseStaff } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';

	// Component
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	// Icon
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import ChefHat from '@lucide/svelte/icons/chef-hat';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	import {
		useRecipes,
		RecipeForm,
		useDeleteRecipe,
		useUpdateRecipe,
		CatalogListToolbar,
		CatalogFormShell,
		CatalogScopeBadge,
		type Recipe
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

	function canModifyRecipe(recipe: Recipe) {
		if (basePath.includes('system-management')) {
			return isSA && !recipe.shelter_code;
		}
		return canWrite;
	}

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let q = $state('');

	const query = useRecipes(() => shelterCode);
	const deleteMutation = useDeleteRecipe();
	const updateRecipeMutation = useUpdateRecipe();

	let deleteConfirmOpen = $state(false);
	let pendingDeleteRecipe = $state<{ id: string; label: string } | null>(null);

	function activateRecipe(recipe: Recipe) {
		const updated = { ...recipe, deactivated: false };
		updateRecipeMutation.mutate(updated, {
			onSuccess: () => {
				toast.success(`นำสูตรอาหาร "${recipe.label}" กลับมาใช้งานสำเร็จ`);
			},
			onError: (err: Error) => {
				toast.error(err.message || 'เกิดข้อผิดพลาดในการทำรายการ');
			}
		});
	}

	function showDeleteConfirm(id: string, label: string) {
		pendingDeleteRecipe = { id, label };
		deleteConfirmOpen = true;
	}

	function confirmDelete() {
		if (!pendingDeleteRecipe) return;
		const { id, label } = pendingDeleteRecipe;
		deleteMutation.mutate(
			{ id, shelterCode },
			{
				onSuccess: (wasDeleted) => {
					if (wasDeleted) {
						toast.success(`ลบสูตรอาหาร "${label}" สำเร็จ`);
					} else {
						toast.success(
							`เปลี่ยนสถานะสูตรอาหาร "${label}" เป็นปิดใช้งาน (Deactivated) เนื่องจากสูตรนี้ถูกใช้งานในระบบแล้ว`
						);
					}
					deleteConfirmOpen = false;
					pendingDeleteRecipe = null;
				},
				onError: (err: Error) => {
					toast.error(err.message || 'เกิดข้อผิดพลาดในการทำรายการ');
				}
			}
		);
	}

	const filteredAll = $derived.by(() => {
		const items = query.data ?? [];
		const needle = q.trim().toLowerCase();
		if (!needle) return items;
		return items.filter((e) => e.label.toLowerCase().includes(needle));
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
				class="hidden items-center gap-4 border-b border-border bg-muted/30 px-4 py-2.5 text-sm font-semibold text-slate-900 sm:grid sm:grid-cols-[1fr_220px] dark:text-slate-100"
			>
				<span>ชื่อข้อมูลมาตรฐาน</span>
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
						<li class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_220px] sm:items-start sm:gap-4">
							<div class="min-w-0 space-y-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-base font-bold text-foreground">{e.label}</span>
									<CatalogScopeBadge doc={e} />
								</div>
								<p class="text-sm text-muted-foreground tabular-nums">
									{e.standard_portions} กล่อง · {e.standard_duration_hours} ชม.
								</p>
							</div>

							<div class="flex flex-wrap items-start gap-2 sm:justify-end">
								{#if canModifyRecipe(e)}
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
												onclick={() => activateRecipe(e)}
												disabled={updateRecipeMutation.isPending}
												class="min-h-11 border-green-200 text-green-600 hover:bg-green-50 hover:text-green-700 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/20"
											>
												<RotateCcw class="h-4 w-4" />
												นำกลับมาใช้
											</Button>
										{:else}
											<Button
												variant="outline"
												size="sm"
												onclick={() => showDeleteConfirm(e._id, e.label)}
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
		title={viewMode === 'edit' ? 'แก้ไขสูตรอาหารมาตรฐาน (BOM)' : 'เพิ่มสูตรอาหารมาตรฐานใหม่ (BOM)'}
		icon={ChefHat}
		{canWrite}
		onclose={backToList}
	>
		<RecipeForm
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
				{#if pendingDeleteRecipe && query.data?.find((i) => i._id === pendingDeleteRecipe?.id)?.override}
					ยืนยันการคืนค่ามาตรฐาน
				{:else}
					ยืนยันการลบสูตรอาหาร
				{/if}
			</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-500">
				{#if pendingDeleteRecipe}
					{@const pendingItem = query.data?.find((i) => i._id === pendingDeleteRecipe?.id)}
					{#if pendingItem?.override}
						คุณแน่ใจหรือไม่ว่าต้องการรีเซ็ตสูตรอาหาร <strong class="text-slate-900"
							>{pendingDeleteRecipe.label}</strong
						>
						กลับเป็นค่ามาตรฐานส่วนกลาง?
						<span class="mt-3 block text-xs leading-relaxed text-muted-foreground">
							* ข้อมูลที่ศูนย์นี้ทำการปรับแต่งไว้จะถูกลบออกทั้งหมด
							และจะกลับไปใช้ค่าเริ่มต้นจากส่วนกลางแทน
						</span>
					{:else}
						คุณแน่ใจหรือไม่ว่าต้องการลบสูตรอาหาร <strong class="text-slate-900"
							>{pendingDeleteRecipe.label}</strong
						>?
						<span class="mt-3 block text-xs leading-relaxed text-muted-foreground">
							* หากสูตรอาหารนี้ถูกใช้ในแผนเตรียมอาหาร (Meal Plan) อยู่ในระบบแล้ว
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
					pendingDeleteRecipe = null;
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
				{:else if pendingDeleteRecipe && query.data?.find((i) => i._id === pendingDeleteRecipe?.id)?.override}
					ยืนยันการคืนค่า
				{:else}
					ยืนยันการลบ
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, isWarehouseStaff } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';

	// Component
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';

	// Icon
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Settings2, Trash2, RotateCcw } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	import {
		useRecipes,
		RecipeForm,
		useDeleteRecipe,
		useUpdateRecipe,
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
		<div class="flex items-center justify-between gap-4">
			<span class="text-md font-bold">รายการข้อมูล ({total})</span>
			<div class="item-center flex gap-2">
				<div class="relative w-72">
					<Search class="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
					<Input bind:value={q} type="search" placeholder="ค้นหา..." class="pl-9" />
				</div>
				{#if canWrite}
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
						<Table.Head class="w-24 text-center font-bold">จัดการ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#if query.isLoading}
						<Table.Row>
							<Table.Cell colspan={2} class="py-6 text-center text-muted-foreground"
								>กำลังโหลดข้อมูล...</Table.Cell
							>
						</Table.Row>
					{:else if filteredAll.length === 0}
						<Table.Row>
							<Table.Cell colspan={2} class="py-6 text-center text-muted-foreground"
								>📭 ไม่พบข้อมูลมาสเตอร์ที่ค้นหาตามเงื่อนไขนี้</Table.Cell
							>
						</Table.Row>
					{:else}
						{#each paginatedItems as e (e._id)}
							<Table.Row>
								<Table.Cell class="font-bold text-foreground">
									{e.label}
									{#if !e.shelter_code}
										<span
											class="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-600/10 ring-inset dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
										>
											ส่วนกลาง
										</span>
									{:else if e.override}
										<span
											class="ml-2 inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700 ring-1 ring-orange-600/10 ring-inset dark:bg-orange-950/40 dark:text-orange-400 dark:ring-orange-500/20"
										>
											ปรับแต่งแล้ว
										</span>
									{:else}
										<span
											class="ml-2 inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700 ring-1 ring-teal-600/10 ring-inset dark:bg-teal-950/40 dark:text-teal-400 dark:ring-teal-500/20"
										>
											เฉพาะศูนย์
										</span>
									{/if}
									{#if e.deactivated}
										<span
											class="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-600/10 ring-inset"
										>
											ปิดใช้งาน (Deactivated)
										</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-center">
									{#if canModifyRecipe(e)}
										<div class="inline-flex gap-2">
											<Button variant="outline" size="sm" onclick={() => showEditForm(e._id)}>
												<Settings2 class="h-4 w-4" />
												จัดการ
											</Button>
											{#if e.shelter_code === shelterCode}
												{#if e.deactivated}
													<Button
														variant="outline"
														size="sm"
														onclick={() => activateRecipe(e)}
														disabled={updateRecipeMutation.isPending}
														class="text-green-600 hover:text-green-700 dark:text-green-400"
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
		{#if canWrite}
			<RecipeForm id={selectedId} isEdit={viewMode === 'edit'} {basePath} onsuccess={backToList} />
		{:else}
			<div class="py-12 text-center text-sm font-bold text-destructive">
				คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (Unauthorized)
			</div>
		{/if}
	</div>
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

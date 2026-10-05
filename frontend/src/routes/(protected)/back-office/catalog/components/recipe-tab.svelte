<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, isWarehouseStaff } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { langState } from '$lib/states/i18n.svelte';

	// Component
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';

	// Icon
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChefHat from '@lucide/svelte/icons/chef-hat';

	import {
		useRecipes,
		useItemMasters,
		useUnitsOfMeasure,
		useDeleteRecipe,
		useUpdateRecipe,
		RecipeForm,
		MasterBadge,
		MasterFilterBar,
		MasterPager,
		useMasterPaging,
		filterRecipes,
		hiddenDeactivatedRecipes,
		ingredientSummary,
		pageSlice,
		catalogOrigin,
		formatUnit,
		MASTER_PAGE_SIZE,
		ORIGIN_LABELS,
		ORIGIN_TONES,
		type CatalogOriginKey,
		type OriginFilter,
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

	/** Delete / reset / reactivate only apply to the recipe's own scope (central vs this shelter). */
	function ownsRecipe(recipe: Recipe) {
		return (recipe.shelter_code || undefined) === (shelterCode || undefined);
	}

	const query = useRecipes(() => shelterCode);
	const itemMastersQuery = useItemMasters(() => shelterCode);
	const unitsQuery = useUnitsOfMeasure();
	const deleteMutation = useDeleteRecipe();
	const updateRecipeMutation = useUpdateRecipe();

	const recipes = $derived(query.data ?? []);
	const itemNames = $derived(new Map((itemMastersQuery.data ?? []).map((i) => [i._id, i.name])));
	const nameOf = (id: string) => itemNames.get(id) ?? id.replace(/^item_master:/, '');
	const unitLabel = (code: string) => formatUnit(code, unitsQuery.data ?? [], langState.current);

	// Filters (local state) and paging
	let q = $state('');
	let origin = $state<OriginFilter>('all');
	let showDeactivated = $state(false);

	const filter = $derived({ q, origin, showDeactivated });
	const filteredAll = $derived(filterRecipes(recipes, filter, shelterCode, nameOf));
	const hiddenDeactivatedCount = $derived(
		hiddenDeactivatedRecipes(recipes, filter, shelterCode, nameOf)
	);
	const filtersActive = $derived(q.trim() !== '' || origin !== 'all');

	const paging = useMasterPaging(
		() => JSON.stringify([q, origin, showDeactivated]),
		() => filteredAll.length
	);
	const pageRows = $derived(pageSlice(filteredAll, paging.page, MASTER_PAGE_SIZE));

	const originOptions = (Object.keys(ORIGIN_LABELS) as CatalogOriginKey[]).map((k) => ({
		value: k,
		label: ORIGIN_LABELS[k]
	}));

	function clearFilters() {
		q = '';
		origin = 'all';
	}

	// Detail / form sheet
	let sheetOpen = $state(false);
	let sheetMode = $state<'view' | 'edit' | 'create'>('view');
	let selectedId = $state('');
	const selected = $derived(recipes.find((r) => r._id === selectedId) ?? null);

	function openRecipe(recipe: Recipe) {
		selectedId = recipe._id;
		sheetMode = 'view';
		sheetOpen = true;
	}

	function openCreate() {
		selectedId = '';
		sheetMode = 'create';
		sheetOpen = true;
	}

	function afterForm() {
		if (sheetMode === 'create') {
			sheetOpen = false;
			selectedId = '';
		} else {
			sheetMode = 'view';
		}
	}

	// Deactivate / reset / delete
	let deleteConfirmOpen = $state(false);
	let pendingDeleteRecipe = $state<{ id: string; label: string } | null>(null);
	const pendingIsOverride = $derived(
		!!pendingDeleteRecipe && !!recipes.find((r) => r._id === pendingDeleteRecipe?.id)?.override
	);

	function activateRecipe(recipe: Recipe) {
		updateRecipeMutation.mutate(
			{ ...recipe, deactivated: false },
			{
				onSuccess: () => {
					toast.success(`นำสูตรอาหาร "${recipe.label}" กลับมาใช้งานสำเร็จ`);
				},
				onError: (err: Error) => {
					toast.error(err.message || 'เกิดข้อผิดพลาดในการทำรายการ');
				}
			}
		);
	}

	function showDeleteConfirm(id: string, label: string) {
		pendingDeleteRecipe = { id, label };
		deleteConfirmOpen = true;
	}

	function confirmDelete() {
		if (!pendingDeleteRecipe) return;
		const { id, label } = pendingDeleteRecipe;
		const isOverride = pendingIsOverride;

		deleteMutation.mutate(
			{ id, shelterCode },
			{
				onSuccess: (wasDeleted) => {
					if (isOverride) {
						toast.success(`คืนค่ามาตรฐานสูตรอาหาร "${label}" สำเร็จ`);
					} else if (!wasDeleted) {
						toast.success(`เปลี่ยนสถานะสูตรอาหาร "${label}" เป็นปิดการใช้งานแล้ว`);
					} else {
						toast.success(`ลบสูตรอาหาร "${label}" ถาวรสำเร็จ`);
					}
					deleteConfirmOpen = false;
					pendingDeleteRecipe = null;
					sheetOpen = false;
				},
				onError: (err: Error) => {
					toast.error(err.message || 'เกิดข้อผิดพลาดในการทำรายการ');
				}
			}
		);
	}
</script>

<div class="space-y-4 pb-20 md:pb-0">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h2 class="text-lg font-bold text-slate-900">สูตรอาหารมาตรฐาน</h2>
			<p class="text-sm text-slate-600">ใช้คำนวณวัตถุดิบที่ต้องเบิกจากคลัง</p>
		</div>
		{#if canWrite}
			<Button
				type="button"
				class="hidden min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930] md:inline-flex"
				onclick={openCreate}
			>
				<Plus class="h-4 w-4" aria-hidden="true" />
				เพิ่มสูตรอาหาร
			</Button>
		{/if}
	</div>

	<div
		class="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
	>
		<MasterFilterBar
			bind:q
			bind:showDeactivated
			searchLabel="ค้นหาสูตรอาหาร"
			searchPlaceholder="ค้นหาชื่อสูตร / วัตถุดิบ"
			switchId="recipes-show-deactivated"
			selects={[
				{
					id: 'origin',
					label: 'กรองที่มา',
					prefix: 'ที่มา',
					value: origin,
					options: originOptions
				}
			]}
			onselect={(_id, value) => (origin = value as OriginFilter)}
		/>

		{#if query.isLoading}
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
					<strong class="font-semibold text-slate-900 tabular-nums">{filteredAll.length}</strong>
					สูตร
				</span>
				{#if hiddenDeactivatedCount > 0}
					<span aria-hidden="true" class="text-slate-400">·</span>
					<span>ซ่อน {hiddenDeactivatedCount} สูตรที่ปิดใช้งาน</span>
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

			{#if filteredAll.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
					<ChefHat class="h-12 w-12 text-slate-300" aria-hidden="true" />
					<p class="text-sm font-medium text-slate-500">
						{recipes.length === 0 ? 'ยังไม่มีสูตรอาหาร' : 'ไม่พบสูตรอาหารที่ตรงเงื่อนไข'}
					</p>
				</div>
			{:else}
				<!-- Phone cards -->
				<ul class="space-y-2.5 p-3 md:hidden">
					{#each pageRows as recipe (recipe._id)}
						{@const o = catalogOrigin(recipe, shelterCode)}
						<li>
							<button
								type="button"
								onclick={() => openRecipe(recipe)}
								class="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white p-3.5 text-left shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {recipe.deactivated
									? 'opacity-70'
									: ''}"
							>
								<span class="min-w-0 flex-1">
									<span class="block text-base font-semibold text-slate-900">{recipe.label}</span>
									<span class="mt-0.5 block text-sm text-slate-600">
										{recipe.ingredients.length} วัตถุดิบ · {recipe.standard_portions} ที่ · {recipe.standard_duration_hours}
										ชม.
									</span>
									<span class="mt-2 flex flex-wrap gap-1.5">
										<MasterBadge tone={ORIGIN_TONES[o]}>{ORIGIN_LABELS[o]}</MasterBadge>
										<MasterBadge tone={recipe.deactivated ? 'red' : 'green'}>
											{recipe.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน'}
										</MasterBadge>
									</span>
								</span>
								<ChevronRight
									class="h-[18px] w-[18px] shrink-0 text-slate-400"
									aria-hidden="true"
								/>
							</button>
						</li>
					{/each}
				</ul>

				<!-- Table (md+) -->
				<div class="hidden flex-1 overflow-x-auto md:block">
					<Table.Root class="text-sm">
						<Table.Header class="border-b border-slate-200/80 bg-slate-50">
							<Table.Row class="text-xs font-semibold text-slate-600">
								<Table.Head class="px-4 py-3">สูตรอาหาร</Table.Head>
								<Table.Head class="px-4 py-3">วัตถุดิบ</Table.Head>
								<Table.Head class="px-4 py-3">ผลิตมาตรฐาน</Table.Head>
								<Table.Head class="px-4 py-3">ที่มา</Table.Head>
								<Table.Head class="px-4 py-3">สถานะ</Table.Head>
								<Table.Head class="w-10 px-3 py-3">
									<span class="sr-only">เปิดรายละเอียด</span>
								</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body class="divide-y divide-slate-100">
							{#each pageRows as recipe (recipe._id)}
								{@const o = catalogOrigin(recipe, shelterCode)}
								<Table.Row
									class="cursor-pointer align-top transition-colors hover:bg-slate-50/80 {recipe.deactivated
										? 'opacity-70'
										: ''}"
									onclick={() => openRecipe(recipe)}
								>
									<Table.Cell class="px-4 py-3.5">
										<button
											type="button"
											class="rounded text-left text-base font-semibold text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
										>
											{recipe.label}
										</button>
									</Table.Cell>
									<Table.Cell class="px-4 py-3.5">
										<p class="font-semibold text-slate-900">{recipe.ingredients.length} รายการ</p>
										<p class="text-xs text-slate-500">{ingredientSummary(recipe, nameOf)}</p>
									</Table.Cell>
									<Table.Cell
										class="px-4 py-3.5 leading-relaxed whitespace-pre-line text-slate-700 tabular-nums"
									>
										{recipe.standard_portions} ที่
										{recipe.standard_duration_hours} ชม.
									</Table.Cell>
									<Table.Cell class="px-4 py-3.5">
										<MasterBadge tone={ORIGIN_TONES[o]}>{ORIGIN_LABELS[o]}</MasterBadge>
									</Table.Cell>
									<Table.Cell class="px-4 py-3.5">
										<MasterBadge tone={recipe.deactivated ? 'red' : 'green'}>
											{recipe.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน'}
										</MasterBadge>
									</Table.Cell>
									<Table.Cell class="w-10 px-3 py-3.5 text-right">
										<ChevronRight
											class="inline h-[18px] w-[18px] text-slate-400"
											aria-hidden="true"
										/>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>

				<MasterPager
					bind:page={paging.page}
					count={filteredAll.length}
					perPage={MASTER_PAGE_SIZE}
					unit="สูตร"
				/>
			{/if}
		{/if}
	</div>
</div>

{#if canWrite}
	<div
		class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
	>
		<Button
			type="button"
			class="min-h-12 w-full gap-2 rounded-lg bg-[#0A2647] text-base font-semibold text-white hover:bg-[#051930]"
			onclick={openCreate}
		>
			<Plus class="h-4 w-4" aria-hidden="true" />
			เพิ่มสูตรอาหาร
		</Button>
	</div>
{/if}

<!-- DETAIL / FORM SHEET -->
<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content
		side="right"
		class="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-none md:w-[36rem] md:border-l"
	>
		{#if sheetMode === 'view' && selected}
			{@const o = catalogOrigin(selected, shelterCode)}
			<Sheet.Header class="shrink-0 space-y-3 border-b border-slate-200/80 p-4 pr-12 text-left">
				<div>
					<p class="text-sm text-slate-500">สูตรอาหารมาตรฐาน</p>
					<Sheet.Title class="mt-0.5 text-xl font-bold text-slate-900">{selected.label}</Sheet.Title
					>
					<Sheet.Description class="sr-only">
						วัตถุดิบและการจัดการสูตรอาหาร {selected.label}
					</Sheet.Description>
				</div>
				<div class="flex flex-wrap gap-1.5">
					<MasterBadge tone={ORIGIN_TONES[o]}>{ORIGIN_LABELS[o]}</MasterBadge>
					<MasterBadge tone={selected.deactivated ? 'red' : 'green'}>
						{selected.deactivated ? 'ปิดใช้งาน' : 'ใช้งาน'}
					</MasterBadge>
				</div>

				<dl class="grid grid-cols-3 gap-2">
					<div class="rounded-xl border border-slate-200/80 bg-slate-50 p-2.5">
						<dt class="text-xs text-slate-500">ผลิตมาตรฐาน</dt>
						<dd class="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
							{selected.standard_portions}
							<span class="text-xs font-normal text-slate-500">ที่</span>
						</dd>
					</div>
					<div class="rounded-xl border border-slate-200/80 bg-slate-50 p-2.5">
						<dt class="text-xs text-slate-500">ระยะเวลา</dt>
						<dd class="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
							{selected.standard_duration_hours}
							<span class="text-xs font-normal text-slate-500">ชม.</span>
						</dd>
					</div>
					<div class="rounded-xl border border-slate-200/80 bg-slate-50 p-2.5">
						<dt class="text-xs text-slate-500">วัตถุดิบ</dt>
						<dd class="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
							{selected.ingredients.length}
							<span class="text-xs font-normal text-slate-500">รายการ</span>
						</dd>
					</div>
				</dl>

				{#if canModifyRecipe(selected)}
					<div class="grid grid-cols-2 gap-2">
						<Button
							type="button"
							class="min-h-11 gap-1.5 rounded-lg bg-[#0A2647] text-sm font-semibold text-white hover:bg-[#051930]"
							onclick={() => (sheetMode = 'edit')}
						>
							<Pencil class="h-4 w-4" aria-hidden="true" />
							แก้ไข
						</Button>
						{#if ownsRecipe(selected)}
							{#if selected.deactivated}
								<Button
									type="button"
									variant="outline"
									class="min-h-11 gap-1.5 rounded-lg border-emerald-200 text-sm font-semibold text-emerald-900"
									disabled={updateRecipeMutation.isPending}
									onclick={() => activateRecipe(selected)}
								>
									<RotateCcw class="h-4 w-4" aria-hidden="true" />
									นำกลับมาใช้
								</Button>
							{:else}
								<Button
									type="button"
									variant="outline"
									class="min-h-11 gap-1.5 rounded-lg text-sm font-semibold {selected.override
										? 'border-amber-200 text-amber-900'
										: 'border-red-200 text-red-800'}"
									disabled={deleteMutation.isPending}
									onclick={() => showDeleteConfirm(selected._id, selected.label)}
								>
									{#if selected.override}
										<RotateCcw class="h-4 w-4" aria-hidden="true" />
										รีเซ็ต
									{:else}
										<Trash2 class="h-4 w-4" aria-hidden="true" />
										ลบ
									{/if}
								</Button>
							{/if}
						{/if}
					</div>
				{/if}
			</Sheet.Header>

			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
				<h3 class="text-sm font-bold text-slate-600">
					วัตถุดิบ ({selected.ingredients.length}) · สำหรับ {selected.standard_portions} ที่ ต่อรอบ
				</h3>
				{#if selected.ingredients.length === 0}
					<p class="py-8 text-center text-sm text-slate-500">สูตรนี้ยังไม่มีวัตถุดิบ</p>
				{:else}
					<ul class="divide-y divide-slate-100 rounded-xl border border-slate-200/80">
						{#each selected.ingredients as ing, i (`${ing.item_master_id}-${i}`)}
							<li class="flex items-center justify-between gap-3 px-3.5 py-3 text-sm">
								<span class="min-w-0 font-semibold text-slate-900"
									>{nameOf(ing.item_master_id)}</span
								>
								<span class="shrink-0 font-bold text-slate-900 tabular-nums">
									{ing.quantity}
									<span class="font-normal text-slate-500">{unitLabel(ing.uom)}</span>
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{:else if sheetMode === 'edit' || sheetMode === 'create'}
			<Sheet.Header class="shrink-0 border-b border-slate-200/80 p-4 pr-12 text-left">
				{#if sheetMode === 'edit'}
					<Button
						type="button"
						variant="ghost"
						class="mb-1 -ml-2 min-h-11 w-fit gap-1.5 px-2 text-sm font-semibold text-sky-800"
						onclick={() => (sheetMode = 'view')}
					>
						<ArrowLeft class="h-4 w-4" aria-hidden="true" />
						กลับไปรายละเอียด
					</Button>
				{/if}
				<Sheet.Title class="text-xl font-bold text-slate-900">
					{sheetMode === 'create' ? 'เพิ่มสูตรอาหารมาตรฐาน (BOM)' : 'แก้ไขสูตรอาหารมาตรฐาน (BOM)'}
				</Sheet.Title>
				<Sheet.Description class="text-sm text-slate-500">
					{sheetMode === 'edit' ? (selected?.label ?? '') : 'กำหนดวัตถุดิบและยอดผลิตมาตรฐาน'}
				</Sheet.Description>
			</Sheet.Header>
			<div class="min-h-0 flex-1 overflow-y-auto p-4">
				{#if canWrite}
					{#key `${sheetMode}-${selectedId}`}
						<RecipeForm
							id={sheetMode === 'edit' ? selectedId : ''}
							isEdit={sheetMode === 'edit'}
							{basePath}
							onsuccess={afterForm}
						/>
					{/key}
				{:else}
					<div class="py-12 text-center text-sm font-bold text-destructive">
						คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (Unauthorized)
					</div>
				{/if}
			</div>
		{:else}
			<Sheet.Title class="sr-only">สูตรอาหาร</Sheet.Title>
			<Sheet.Description class="sr-only">ไม่พบสูตรอาหารที่เลือก</Sheet.Description>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content class="sm:max-w-[420px]">
		<Dialog.Header>
			<Dialog.Title class="text-red-700">
				{pendingIsOverride ? 'ยืนยันการคืนค่ามาตรฐาน' : 'ยืนยันการลบสูตรอาหาร'}
			</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-600">
				{#if pendingDeleteRecipe}
					{#if pendingIsOverride}
						คุณแน่ใจหรือไม่ว่าต้องการรีเซ็ตสูตรอาหาร <strong class="text-slate-900"
							>{pendingDeleteRecipe.label}</strong
						>
						กลับเป็นค่ามาตรฐานส่วนกลาง?
						<span class="mt-3 block text-xs leading-relaxed text-slate-500">
							* ข้อมูลที่ศูนย์นี้ทำการปรับแต่งไว้จะถูกลบออกทั้งหมด
							และจะกลับไปใช้ค่าเริ่มต้นจากส่วนกลางแทน
						</span>
					{:else}
						คุณแน่ใจหรือไม่ว่าต้องการลบสูตรอาหาร <strong class="text-slate-900"
							>{pendingDeleteRecipe.label}</strong
						>?
						<span class="mt-3 block text-xs leading-relaxed text-slate-500">
							* หากสูตรอาหารนี้ถูกใช้ในแผนเตรียมอาหาร (Meal Plan) อยู่ในระบบแล้ว
							หรือเป็นสูตรอาหารมาตรฐานส่วนกลาง ระบบจะเปลี่ยนสถานะเป็นปิดการใช้งาน แทนการลบถาวร
							เพื่อรักษาความสมบูรณ์ของข้อมูลอ้างอิง
						</span>
					{/if}
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-2 flex justify-end gap-3 pt-4">
			<Button
				type="button"
				variant="outline"
				class="min-h-11"
				onclick={() => {
					deleteConfirmOpen = false;
					pendingDeleteRecipe = null;
				}}
			>
				ยกเลิก
			</Button>
			<Button
				variant="destructive"
				class="min-h-11"
				disabled={deleteMutation.isPending}
				onclick={confirmDelete}
			>
				{#if deleteMutation.isPending}
					กำลังดำเนินการ...
				{:else if pendingIsOverride}
					ยืนยันการคืนค่า
				{:else}
					ยืนยันการลบ
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

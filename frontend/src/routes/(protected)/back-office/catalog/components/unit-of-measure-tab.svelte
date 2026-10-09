<script lang="ts">
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin } from '$lib/auth/roles';
	import { toast } from 'svelte-sonner';

	// UI Components
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Field from '$lib/components/ui/field/index.js';

	// Icons
	import Plus from '@lucide/svelte/icons/plus';
	import Lock from '@lucide/svelte/icons/lock';
	import Ruler from '@lucide/svelte/icons/ruler';

	// Feature & Domain
	import {
		useUnitsOfMeasure,
		useCreateUnitOfMeasure,
		useUpdateUnitOfMeasure,
		useDeleteUnitOfMeasure,
		unitOfMeasureInputSchema,
		unitOfMeasureUpdateSchema,
		MasterBadge,
		MasterFilterBar,
		MasterPager,
		useMasterPaging,
		filterUnits,
		hiddenDeactivatedUnits,
		pageSlice,
		MASTER_PAGE_SIZE,
		type MasterBadgeTone,
		type UnitOfMeasure,
		type Dimension
	} from '$lib/features/catalog';

	let {
		basePath = '/back-office/catalog'
	}: {
		basePath?: string;
	} = $props();

	const isSystemManagement = $derived(basePath.includes('system-management'));

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));

	const query = useUnitsOfMeasure();
	const createMutation = useCreateUnitOfMeasure();
	const updateMutation = useUpdateUnitOfMeasure();
	const deleteMutation = useDeleteUnitOfMeasure();

	// Filters (local state) and paging
	let q = $state('');
	let dimension = $state<Dimension | 'all'>('all');
	let showDeactivated = $state(false);

	const filter = $derived({ q, dimension, showDeactivated });
	const filteredAll = $derived(filterUnits(query.data ?? [], filter));
	const hiddenDeactivatedCount = $derived(hiddenDeactivatedUnits(query.data ?? [], filter));
	const filtersActive = $derived(q.trim() !== '' || dimension !== 'all');

	const paging = useMasterPaging(
		() => JSON.stringify([q, dimension, showDeactivated]),
		() => filteredAll.length
	);
	const paginatedItems = $derived(pageSlice(filteredAll, paging.page, MASTER_PAGE_SIZE));

	function clearFilters() {
		q = '';
		dimension = 'all';
	}

	// Unified Create / Edit Form State
	let formDialogOpen = $state(false);
	let editingUnit = $state<UnitOfMeasure | null>(null);
	const isEdit = $derived(!!editingUnit);

	let formCode = $state('');
	let formLabelTh = $state('');
	let formLabelThShort = $state('');
	let formLabelEn = $state('');
	let formDimension = $state<Dimension>('count');
	let formSortOrder = $state<number>(100);
	let formDeactivated = $state(false);
	let formErrors = $state<Record<string, string>>({});

	function openCreateDialog() {
		editingUnit = null;
		formCode = '';
		formLabelTh = '';
		formLabelThShort = '';
		formLabelEn = '';
		formDimension = 'count';
		formSortOrder = 100;
		formDeactivated = false;
		formErrors = {};
		formDialogOpen = true;
	}

	function openEditDialog(unit: UnitOfMeasure) {
		editingUnit = unit;
		formCode = unit.code;
		formLabelTh = unit.label_th;
		formLabelThShort = unit.label_th_short ?? '';
		formLabelEn = unit.label_en;
		formDimension = unit.dimension;
		formSortOrder = unit.sort_order ?? 100;
		formDeactivated = unit.deactivated ?? false;
		formErrors = {};
		formDialogOpen = true;
	}

	function handleSubmit() {
		formErrors = {};

		if (isEdit && editingUnit) {
			const result = unitOfMeasureUpdateSchema.safeParse({
				label_th: formLabelTh.trim(),
				label_th_short: formLabelThShort.trim() || undefined,
				label_en: formLabelEn.trim(),
				sort_order: formSortOrder ? Number(formSortOrder) : undefined,
				deactivated: formDeactivated
			});

			if (!result.success) {
				const formatted = result.error.format();
				formErrors = {
					label_th: formatted.label_th?._errors?.[0] ?? '',
					label_th_short: formatted.label_th_short?._errors?.[0] ?? '',
					label_en: formatted.label_en?._errors?.[0] ?? ''
				};
				return;
			}

			updateMutation.mutate(
				{
					...editingUnit,
					...result.data
				},
				{
					onSuccess: () => {
						toast.success(`อัปเดตข้อมูลหน่วยนับ "${editingUnit?.code}" สำเร็จ`);
						formDialogOpen = false;
						editingUnit = null;
					},
					onError: (err: Error) => {
						toast.error(err.message || 'ไม่สามารถแก้ไขข้อมูลหน่วยนับได้');
					}
				}
			);
		} else {
			const result = unitOfMeasureInputSchema.safeParse({
				code: formCode.trim().toLowerCase(),
				label_th: formLabelTh.trim(),
				label_th_short: formLabelThShort.trim() || undefined,
				label_en: formLabelEn.trim(),
				dimension: formDimension,
				sort_order: formSortOrder ? Number(formSortOrder) : undefined
			});

			if (!result.success) {
				const formatted = result.error.format();
				formErrors = {
					code: formatted.code?._errors?.[0] ?? '',
					label_th: formatted.label_th?._errors?.[0] ?? '',
					label_th_short: formatted.label_th_short?._errors?.[0] ?? '',
					label_en: formatted.label_en?._errors?.[0] ?? '',
					dimension: formatted.dimension?._errors?.[0] ?? ''
				};
				return;
			}

			createMutation.mutate(result.data, {
				onSuccess: () => {
					toast.success(`เพิ่มหน่วยนับ "${result.data.label_th} (${result.data.code})" สำเร็จ`);
					formDialogOpen = false;
					editingUnit = null;
				},
				onError: (err: Error) => {
					toast.error(err.message || 'ไม่สามารถสร้างหน่วยนับได้');
				}
			});
		}
	}

	// Delete Dialog State
	let deleteConfirmOpen = $state(false);
	let pendingDeleteUnit = $state<UnitOfMeasure | null>(null);

	function openDeleteDialog(unit: UnitOfMeasure) {
		if (unit.is_protected) {
			toast.error('หน่วยมาตรฐานของระบบได้รับการป้องกัน ไม่สามารถลบได้');
			return;
		}
		pendingDeleteUnit = unit;
		deleteConfirmOpen = true;
	}

	function confirmDelete() {
		if (!pendingDeleteUnit) return;
		deleteMutation.mutate(pendingDeleteUnit.code, {
			onSuccess: () => {
				toast.success(`ลบหน่วยนับ "${pendingDeleteUnit?.code}" เรียบร้อยแล้ว`);
				deleteConfirmOpen = false;
				pendingDeleteUnit = null;
			},
			onError: (err: Error) => {
				toast.error(err.message || 'ไม่สามารถลบหน่วยนับได้');
			}
		});
	}

	const DIMENSION_LABELS: Record<Dimension, { th: string; tone: MasterBadgeTone }> = {
		energy: { th: 'พลังงาน', tone: 'orange' },
		count: { th: 'จำนวนนับ', tone: 'blue' },
		mass: { th: 'น้ำหนัก', tone: 'green' },
		volume: { th: 'ปริมาตร', tone: 'cyan' },
		length: { th: 'ความยาว', tone: 'purple' }
	};

	const DIMENSION_OPTIONS = (Object.keys(DIMENSION_LABELS) as Dimension[]).map((d) => ({
		value: d,
		label: DIMENSION_LABELS[d].th
	}));
</script>

<div class="space-y-4 pb-20 md:pb-0">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h2 class="text-lg font-bold text-slate-900">หน่วยนับมาตรฐาน (Unit of Measure)</h2>
			<p class="text-sm text-slate-600">
				{isSystemManagement
					? 'หน่วยนับมาตรฐานของระบบกลาง ใช้ร่วมกันทุกศูนย์'
					: 'หน่วยนับสากลที่ใช้บันทึกสต็อกและคำนวณในคลัง'}
				{#if !isSA}(อ่านอย่างเดียว){/if}
			</p>
		</div>
		{#if isSA}
			<Button
				type="button"
				class="hidden min-h-11 gap-2 rounded-lg bg-[#0A2647] px-4 text-sm font-semibold text-white hover:bg-[#051930] md:inline-flex"
				onclick={openCreateDialog}
			>
				<Plus class="h-4 w-4" aria-hidden="true" />
				เพิ่มหน่วยนับ
			</Button>
		{/if}
	</div>

	<div
		class="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
	>
		<MasterFilterBar
			bind:q
			bind:showDeactivated
			searchLabel="ค้นหาหน่วยนับ"
			searchPlaceholder="ค้นหารหัส / ชื่อไทย / ชื่ออังกฤษ"
			switchId="units-show-deactivated"
			selects={[
				{
					id: 'dimension',
					label: 'กรองมิติการวัด',
					prefix: 'มิติ',
					value: dimension,
					options: DIMENSION_OPTIONS
				}
			]}
			onselect={(_id, value) => (dimension = value as Dimension | 'all')}
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
					หน่วย
				</span>
				{#if hiddenDeactivatedCount > 0}
					<span aria-hidden="true" class="text-slate-400">·</span>
					<span>ซ่อน {hiddenDeactivatedCount} หน่วยที่ปิดใช้งาน</span>
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
					<Ruler class="h-12 w-12 text-slate-300" aria-hidden="true" />
					<p class="text-sm font-medium text-slate-500">ไม่พบหน่วยนับที่ตรงเงื่อนไข</p>
				</div>
			{:else}
				<!-- Phone cards -->
				<ul class="space-y-2.5 p-3 md:hidden">
					{#each paginatedItems as item (item._id)}
						<li
							class="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs {item.deactivated
								? 'opacity-70'
								: ''}"
						>
							<p class="text-base font-semibold text-slate-900">
								{item.label_th}{#if item.label_th_short}
									<span class="font-normal text-slate-500"> ({item.label_th_short})</span>{/if}
							</p>
							<p class="mt-0.5 text-sm text-slate-500">{item.code} · {item.label_en}</p>
							<div class="mt-2 flex flex-wrap gap-1.5">
								<MasterBadge tone={DIMENSION_LABELS[item.dimension]?.tone ?? 'slate'}>
									{DIMENSION_LABELS[item.dimension]?.th ?? item.dimension}
								</MasterBadge>
								{#if item.is_protected}
									<MasterBadge tone="slate"
										><Lock class="h-3 w-3" aria-hidden="true" />ระบบล็อก</MasterBadge
									>
								{:else if item.deactivated}
									<MasterBadge tone="red">ปิดใช้งาน</MasterBadge>
								{:else}
									<MasterBadge tone="green">พร้อมใช้</MasterBadge>
								{/if}
							</div>
							{#if isSA}
								<div class="mt-3 flex flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										class="min-h-11 rounded-lg border-slate-300 text-sm font-semibold"
										onclick={() => openEditDialog(item)}
									>
										แก้ไข
									</Button>
									{#if !item.is_protected}
										<Button
											type="button"
											variant="outline"
											class="min-h-11 rounded-lg border-red-200 text-sm font-semibold text-red-800"
											onclick={() => openDeleteDialog(item)}
										>
											ลบ
										</Button>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<!-- Table (md+) -->
				<div class="hidden flex-1 overflow-x-auto md:block">
					<Table.Root class="text-sm">
						<Table.Header class="border-b border-slate-200/80 bg-slate-50">
							<Table.Row class="text-xs font-semibold text-slate-600">
								<Table.Head class="px-4 py-3">รหัส</Table.Head>
								<Table.Head class="px-4 py-3">ชื่อไทย</Table.Head>
								<Table.Head class="px-4 py-3">ชื่ออังกฤษ</Table.Head>
								<Table.Head class="px-4 py-3">มิติการวัด</Table.Head>
								<Table.Head class="px-4 py-3">สถานะ</Table.Head>
								<Table.Head class="px-4 py-3 text-right">ลำดับ</Table.Head>
								{#if isSA}
									<Table.Head class="px-4 py-3 text-right">จัดการ</Table.Head>
								{/if}
							</Table.Row>
						</Table.Header>
						<Table.Body class="divide-y divide-slate-100">
							{#each paginatedItems as item (item._id)}
								<Table.Row class={item.deactivated ? 'opacity-70' : ''}>
									<Table.Cell class="px-4 py-3 font-bold text-slate-900">{item.code}</Table.Cell>
									<Table.Cell class="px-4 py-3 text-base font-semibold text-slate-900">
										{item.label_th}{#if item.label_th_short}
											<span class="font-normal text-slate-500"> ({item.label_th_short})</span>{/if}
									</Table.Cell>
									<Table.Cell class="px-4 py-3 text-slate-700">{item.label_en}</Table.Cell>
									<Table.Cell class="px-4 py-3">
										<MasterBadge tone={DIMENSION_LABELS[item.dimension]?.tone ?? 'slate'}>
											{DIMENSION_LABELS[item.dimension]?.th ?? item.dimension}
										</MasterBadge>
									</Table.Cell>
									<Table.Cell class="px-4 py-3">
										{#if item.is_protected}
											<MasterBadge tone="slate">
												<Lock class="h-3 w-3" aria-hidden="true" />ระบบล็อก
											</MasterBadge>
										{:else if item.deactivated}
											<MasterBadge tone="red">ปิดใช้งาน</MasterBadge>
										{:else}
											<MasterBadge tone="green">พร้อมใช้</MasterBadge>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-4 py-3 text-right text-slate-500 tabular-nums">
										{item.sort_order ?? '—'}
									</Table.Cell>
									{#if isSA}
										<Table.Cell class="px-4 py-2 text-right">
											<div class="flex items-center justify-end gap-2">
												<Button
													type="button"
													variant="outline"
													class="min-h-11 rounded-lg border-slate-300 text-sm font-semibold"
													onclick={() => openEditDialog(item)}
												>
													แก้ไข
												</Button>
												{#if item.is_protected}
													<span class="px-2 text-xs text-slate-400">ลบไม่ได้</span>
												{:else}
													<Button
														type="button"
														variant="outline"
														class="min-h-11 rounded-lg border-red-200 text-sm font-semibold text-red-800"
														onclick={() => openDeleteDialog(item)}
													>
														ลบ
													</Button>
												{/if}
											</div>
										</Table.Cell>
									{/if}
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>

				<MasterPager
					bind:page={paging.page}
					count={filteredAll.length}
					perPage={MASTER_PAGE_SIZE}
					unit="หน่วย"
				/>
			{/if}
		{/if}
	</div>
</div>

{#if isSA}
	<div
		class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
	>
		<Button
			type="button"
			class="min-h-12 w-full gap-2 rounded-lg bg-[#0A2647] text-base font-semibold text-white hover:bg-[#051930]"
			onclick={openCreateDialog}
		>
			<Plus class="h-4 w-4" aria-hidden="true" />
			เพิ่มหน่วยนับ
		</Button>
	</div>
{/if}

<!-- CREATE / EDIT SHEET -->
<Sheet.Root bind:open={formDialogOpen}>
	<Sheet.Content
		side="right"
		class="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-none md:w-[28rem] md:border-l"
	>
		<Sheet.Header class="shrink-0 border-b border-slate-200/80 p-4 pr-12 text-left">
			<Sheet.Title class="text-xl font-bold text-slate-900">
				{#if isEdit}
					แก้ไขหน่วยนับ: {editingUnit?.code}
				{:else}
					เพิ่มหน่วยนับใหม่
				{/if}
			</Sheet.Title>
			<Sheet.Description class="text-sm text-slate-500">
				{isEdit
					? 'ปรับปรุงชื่อเรียกและสถานะการใช้งานของหน่วยนับ'
					: 'กำหนดหน่วยนับมาตรฐานสำหรับใช้งานในรายการสิ่งของและคลังสินค้า'}
			</Sheet.Description>
		</Sheet.Header>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			class="flex min-h-0 flex-1 flex-col"
		>
			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
				<Field.Field data-invalid={(!isEdit && !!formErrors.code) || undefined}>
					<Field.Label for="uom-code">
						รหัสหน่วย (Unit Code) {#if !isEdit}<span class="text-destructive">*</span>{/if}
					</Field.Label>
					<Input
						id="uom-code"
						type="text"
						bind:value={formCode}
						disabled={isEdit}
						placeholder="เช่น box, kg, pack"
						aria-invalid={!isEdit && !!formErrors.code}
						class="min-h-11"
					/>
					{#if !isEdit && formErrors.code}
						<Field.Error>{formErrors.code}</Field.Error>
					{/if}
					<Field.Description>
						{isEdit
							? 'รหัสหน่วยใช้เป็นคีย์อ้างอิงในฐานข้อมูล ไม่สามารถแก้ไขได้'
							: 'ตัวอักษรภาษาอังกฤษตัวพิมพ์เล็ก ตัวเลข หรือขีดล่าง ไม่สามารถแก้ไขได้ภายหลัง'}
					</Field.Description>
				</Field.Field>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<Field.Field data-invalid={!!formErrors.label_th || undefined}>
						<Field.Label for="uom-label-th">
							ชื่อภาษาไทย <span class="text-destructive">*</span>
						</Field.Label>
						<Input
							id="uom-label-th"
							type="text"
							bind:value={formLabelTh}
							placeholder="เช่น กล่อง, กิโลกรัม"
							aria-invalid={!!formErrors.label_th}
							class="min-h-11"
						/>
						{#if formErrors.label_th}
							<Field.Error>{formErrors.label_th}</Field.Error>
						{/if}
					</Field.Field>

					<Field.Field>
						<Field.Label for="uom-label-th-short">ชื่อย่อภาษาไทย</Field.Label>
						<Input
							id="uom-label-th-short"
							type="text"
							bind:value={formLabelThShort}
							placeholder="เช่น กก., ล."
							class="min-h-11"
						/>
					</Field.Field>
				</div>

				<Field.Field data-invalid={!!formErrors.label_en || undefined}>
					<Field.Label for="uom-label-en">
						ชื่อภาษาอังกฤษ <span class="text-destructive">*</span>
					</Field.Label>
					<Input
						id="uom-label-en"
						type="text"
						bind:value={formLabelEn}
						placeholder="เช่น can, kilogram"
						aria-invalid={!!formErrors.label_en}
						class="min-h-11"
					/>
					{#if formErrors.label_en}
						<Field.Error>{formErrors.label_en}</Field.Error>
					{/if}
				</Field.Field>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<Field.Field data-invalid={(!isEdit && !!formErrors.dimension) || undefined}>
						<Field.Label for="uom-dimension">
							มิติการวัด (Dimension) {#if !isEdit}<span class="text-destructive">*</span>{/if}
						</Field.Label>
						{#if isEdit}
							<Input
								id="uom-dimension"
								value={DIMENSION_LABELS[formDimension]?.th ?? formDimension}
								disabled
								class="min-h-11"
							/>
							<Field.Description>มิติการวัดไม่สามารถแก้ไขได้</Field.Description>
						{:else}
							<Select.Root
								type="single"
								value={formDimension}
								onValueChange={(value) => {
									if (value) formDimension = value as Dimension;
								}}
							>
								<Select.Trigger id="uom-dimension" class="min-h-11 w-full">
									{DIMENSION_LABELS[formDimension]?.th} ({formDimension})
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="count">จำนวนนับ (count)</Select.Item>
									<Select.Item value="mass">น้ำหนัก (mass)</Select.Item>
									<Select.Item value="volume">ปริมาตร (volume)</Select.Item>
									<Select.Item value="length">ความยาว (length)</Select.Item>
									<Select.Item value="energy">พลังงาน (energy)</Select.Item>
								</Select.Content>
							</Select.Root>
						{/if}
					</Field.Field>
					<Field.Field>
						<Field.Label for="uom-sort-order">ลำดับการแสดงผล</Field.Label>
						<Input
							id="uom-sort-order"
							type="number"
							bind:value={formSortOrder}
							min="1"
							class="min-h-11 tabular-nums"
						/>
					</Field.Field>
				</div>

				{#if isEdit}
					<div class="rounded-xl border border-slate-200/80 bg-slate-50 p-3">
						<Field.Field orientation="horizontal" class="items-start gap-2.5">
							<Checkbox id="edit-deactivated" bind:checked={formDeactivated} class="mt-0.5" />
							<Field.Content>
								<Field.Label for="edit-deactivated" class="cursor-pointer">
									ปิดการใช้งานหน่วยนี้ (Deactivate)
								</Field.Label>
								<Field.Description>
									หน่วยที่ปิดใช้งานจะไม่ปรากฏให้เลือกในฟอร์มสร้างสินค้าใหม่
									แต่ยังคงแสดงผลในรายการสินค้าเดิมได้อย่างถูกต้อง
								</Field.Description>
							</Field.Content>
						</Field.Field>
					</div>
				{/if}
			</div>

			<div class="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200/80 p-4">
				<Button
					type="button"
					variant="outline"
					class="min-h-12 rounded-lg border-slate-300 text-sm font-semibold"
					onclick={() => (formDialogOpen = false)}
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					class="min-h-12 rounded-lg bg-[#0A2647] text-sm font-semibold text-white hover:bg-[#051930]"
					disabled={isEdit ? updateMutation.isPending : createMutation.isPending}
				>
					{#if isEdit}
						{updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
					{:else}
						{createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกหน่วยนับ'}
					{/if}
				</Button>
			</div>
		</form>
	</Sheet.Content>
</Sheet.Root>

<!-- DELETE CONFIRM DIALOG -->
<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content class="sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title class="text-destructive">ยืนยันการลบหน่วยนับ</Dialog.Title>
			<Dialog.Description>
				คุณแน่ใจหรือไม่ว่าต้องการลบหน่วยนับ <strong class="text-foreground"
					>{pendingDeleteUnit?.code}</strong
				>
				({pendingDeleteUnit?.label_th})?
				<span class="mt-2 block text-xs text-amber-700">
					* โปรดตรวจสอบให้แน่ใจว่าไม่มีรายการสินค้าในแคตตาล็อกกำลังอ้างอิงหน่วยนับนี้
				</span>
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-4 flex justify-end gap-2">
			<Button
				type="button"
				variant="outline"
				class="min-h-11"
				onclick={() => {
					deleteConfirmOpen = false;
					pendingDeleteUnit = null;
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
				{deleteMutation.isPending ? 'กำลังลบ...' : 'ยืนยันการลบ'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

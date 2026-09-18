<script lang="ts">
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin } from '$lib/auth/roles';
	import { toast } from 'svelte-sonner';

	// UI Components
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';

	// Icons
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import Lock from '@lucide/svelte/icons/lock';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	// Feature & Domain
	import {
		useUnitsOfMeasure,
		useCreateUnitOfMeasure,
		useUpdateUnitOfMeasure,
		useDeleteUnitOfMeasure,
		unitOfMeasureInputSchema,
		unitOfMeasureUpdateSchema,
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

	// Search & Pagination
	let q = $state('');
	const PAGE_SIZE = 10;
	let currentPage = $state(1);

	const filteredAll = $derived.by(() => {
		const items = query.data ?? [];
		const needle = q.trim().toLowerCase();
		if (!needle) return items;
		return items.filter(
			(u) =>
				u.code.toLowerCase().includes(needle) ||
				u.label_th.toLowerCase().includes(needle) ||
				(u.label_th_short && u.label_th_short.toLowerCase().includes(needle)) ||
				u.label_en.toLowerCase().includes(needle) ||
				u.dimension.toLowerCase().includes(needle)
		);
	});

	const total = $derived(filteredAll.length);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const clampedPage = $derived(Math.max(1, Math.min(currentPage, totalPages)));

	const paginatedItems = $derived.by(() => {
		const start = (clampedPage - 1) * PAGE_SIZE;
		return filteredAll.slice(start, start + PAGE_SIZE);
	});

	$effect(() => {
		if (q) currentPage = 1;
	});

	// Create Dialog State
	let createDialogOpen = $state(false);
	let createCode = $state('');
	let createLabelTh = $state('');
	let createLabelThShort = $state('');
	let createLabelEn = $state('');
	let createDimension = $state<Dimension>('count');
	let createSortOrder = $state<number>(100);
	let createErrors = $state<Record<string, string>>({});

	function resetCreateForm() {
		createCode = '';
		createLabelTh = '';
		createLabelThShort = '';
		createLabelEn = '';
		createDimension = 'count';
		createSortOrder = 100;
		createErrors = {};
	}

	function openCreateDialog() {
		resetCreateForm();
		createDialogOpen = true;
	}

	function handleCreate() {
		createErrors = {};
		const result = unitOfMeasureInputSchema.safeParse({
			code: createCode.trim().toLowerCase(),
			label_th: createLabelTh.trim(),
			label_th_short: createLabelThShort.trim() || undefined,
			label_en: createLabelEn.trim(),
			dimension: createDimension,
			sort_order: createSortOrder ? Number(createSortOrder) : undefined
		});

		if (!result.success) {
			const formatted = result.error.format();
			createErrors = {
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
				createDialogOpen = false;
				resetCreateForm();
			},
			onError: (err: Error) => {
				toast.error(err.message || 'ไม่สามารถสร้างหน่วยนับได้');
			}
		});
	}

	// Edit Dialog State
	let editDialogOpen = $state(false);
	let editingUnit = $state<UnitOfMeasure | null>(null);
	let editLabelTh = $state('');
	let editLabelThShort = $state('');
	let editLabelEn = $state('');
	let editSortOrder = $state<number>(100);
	let editDeactivated = $state(false);
	let editErrors = $state<Record<string, string>>({});

	function openEditDialog(unit: UnitOfMeasure) {
		editingUnit = unit;
		editLabelTh = unit.label_th;
		editLabelThShort = unit.label_th_short ?? '';
		editLabelEn = unit.label_en;
		editSortOrder = unit.sort_order ?? 100;
		editDeactivated = unit.deactivated ?? false;
		editErrors = {};
		editDialogOpen = true;
	}

	function handleUpdate() {
		if (!editingUnit) return;
		editErrors = {};

		const result = unitOfMeasureUpdateSchema.safeParse({
			label_th: editLabelTh.trim(),
			label_th_short: editLabelThShort.trim() || undefined,
			label_en: editLabelEn.trim(),
			sort_order: editSortOrder ? Number(editSortOrder) : undefined,
			deactivated: editDeactivated
		});

		if (!result.success) {
			const formatted = result.error.format();
			editErrors = {
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
					editDialogOpen = false;
					editingUnit = null;
				},
				onError: (err: Error) => {
					toast.error(err.message || 'ไม่สามารถแก้ไขข้อมูลหน่วยนับได้');
				}
			}
		);
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

	const DIMENSION_LABELS: Record<Dimension, { th: string; color: string }> = {
		count: {
			th: 'จำนวนนับ',
			color:
				'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800'
		},
		mass: {
			th: 'น้ำหนัก',
			color:
				'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
		},
		volume: {
			th: 'ปริมาตร',
			color:
				'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-400 dark:border-cyan-800'
		},
		length: {
			th: 'ความยาว',
			color:
				'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800'
		}
	};
</script>

<div class="flex w-full flex-col gap-4">
	<!-- Top Bar -->
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
		<div>
			<h2 class="text-base font-bold text-slate-800 dark:text-slate-100">
				หน่วยนับมาตรฐาน (Unit of Measure)
			</h2>
			<p class="text-xs text-muted-foreground">
				{isSystemManagement
					? `หน่วยนับมาตรฐานของระบบกลาง (${total} รายการ)`
					: `รายการหน่วยนับสากลที่ใช้บันทึกสต็อกและควบคุมคำนวณในคลัง (${total} รายการ)`}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative w-full sm:w-64">
				<Search class="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
				<Input
					bind:value={q}
					type="search"
					placeholder="ค้นหาหน่วยนับ..."
					class="h-9 pl-9 text-xs"
				/>
			</div>
			{#if isSA}
				<Button
					size="sm"
					class="h-9 shrink-0 gap-1.5 text-xs font-semibold"
					onclick={openCreateDialog}
				>
					<Plus class="h-4 w-4" />
					เพิ่มหน่วยนับ
				</Button>
			{/if}
		</div>
	</div>

	<!-- Table -->
	<div
		class="overflow-x-auto rounded-xl border border-slate-200/80 bg-card shadow-2xs dark:border-zinc-800"
	>
		<Table.Root>
			<Table.Header>
				<Table.Row class="bg-slate-50/70 dark:bg-zinc-900/50">
					<Table.Head class="font-bold text-slate-800 dark:text-slate-200"
						>รหัสหน่วย (Code)</Table.Head
					>
					<Table.Head class="font-bold text-slate-800 dark:text-slate-200">ชื่อภาษาไทย</Table.Head>
					<Table.Head class="font-bold text-slate-800 dark:text-slate-200"
						>ชื่อภาษาอังกฤษ</Table.Head
					>
					<Table.Head class="font-bold text-slate-800 dark:text-slate-200">มิติการวัด</Table.Head>
					<Table.Head class="text-center font-bold text-slate-800 dark:text-slate-200"
						>สถานะ</Table.Head
					>
					<Table.Head class="w-16 text-center font-bold text-slate-800 dark:text-slate-200"
						>ลำดับ</Table.Head
					>
					{#if isSA}
						<Table.Head class="w-24 text-center font-bold text-slate-800 dark:text-slate-200"
							>จัดการ</Table.Head
						>
					{/if}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if query.isLoading}
					<Table.Row>
						<Table.Cell
							colspan={isSA ? 7 : 6}
							class="py-8 text-center text-sm text-muted-foreground"
						>
							กำลังโหลดข้อมูลหน่วยนับ...
						</Table.Cell>
					</Table.Row>
				{:else if filteredAll.length === 0}
					<Table.Row>
						<Table.Cell
							colspan={isSA ? 7 : 6}
							class="py-8 text-center text-sm text-muted-foreground"
						>
							📭 ไม่พบข้อมูลหน่วยนับที่ค้นหา
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each paginatedItems as item (item._id)}
						<Table.Row class="hover:bg-slate-50/50 dark:hover:bg-zinc-900/30">
							<Table.Cell class="font-mono text-xs font-bold text-foreground">
								{item.code}
							</Table.Cell>
							<Table.Cell class="text-xs font-semibold text-slate-800 dark:text-slate-200">
								{item.label_th}
								{#if item.label_th_short}
									<span class="ml-1 font-normal text-muted-foreground">({item.label_th_short})</span
									>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-xs text-slate-600 dark:text-slate-300">
								{item.label_en}
							</Table.Cell>
							<Table.Cell>
								<span
									class="inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-semibold {DIMENSION_LABELS[
										item.dimension
									]?.color ?? ''}"
								>
									{DIMENSION_LABELS[item.dimension]?.th ?? item.dimension}
								</span>
							</Table.Cell>
							<Table.Cell class="text-center">
								{#if item.is_protected}
									<span
										class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-2xs font-bold text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
										title="หน่วยมาตรฐานของระบบ ไม่สามารถลบหรือเปลี่ยนรหัสได้"
									>
										<Lock class="h-3 w-3 text-slate-500" />
										ระบบล็อก
									</span>
								{:else if item.deactivated}
									<span
										class="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-2xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
									>
										ปิดใช้งาน
									</span>
								{:else}
									<span
										class="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
									>
										พร้อมใช้
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-center font-mono text-xs text-muted-foreground tabular-nums">
								{item.sort_order ?? '—'}
							</Table.Cell>
							{#if isSA}
								<Table.Cell class="text-center">
									<div class="flex items-center justify-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											class="h-7 w-7 text-slate-600 hover:text-primary dark:text-slate-300"
											onclick={() => openEditDialog(item)}
											title="แก้ไขข้อมูลหน่วยนับ"
										>
											<Pencil class="h-3.5 w-3.5" />
										</Button>
										{#if !item.is_protected}
											<Button
												variant="ghost"
												size="icon"
												class="h-7 w-7 text-destructive hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
												onclick={() => openDeleteDialog(item)}
												title="ลบหน่วยนับ"
											>
												<Trash2 class="h-3.5 w-3.5" />
											</Button>
										{/if}
									</div>
								</Table.Cell>
							{/if}
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>

	<!-- Pagination -->
	{#if totalPages > 1}
		<div class="mt-2 flex justify-end">
			<Pagination.Root
				bind:page={() => clampedPage, (p) => (currentPage = p)}
				count={total}
				perPage={PAGE_SIZE}
			>
				{#snippet children({ pages })}
					<Pagination.Content>
						<Pagination.Previous />
						{#each pages as p, i (i)}
							<Pagination.Item>
								{#if p.type === 'page'}
									<Pagination.Link page={p} isActive={p.value === clampedPage} />
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

<!-- CREATE DIALOG -->
<Dialog.Root bind:open={createDialogOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[480px]">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold text-slate-800 dark:text-slate-100">
				เพิ่มหน่วยนับมาตรฐาน (Unit of Measure) ใหม่
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				กำหนดรหัสและชื่อเรียกสำหรับหน่วยนับใหม่ที่จะนำไปใช้ในแคตตาล็อกสินค้า
			</Dialog.Description>
		</Dialog.Header>

		<div class="mt-4 space-y-4">
			<div>
				<label
					for="uom-code"
					class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
				>
					รหัสหน่วย (Unit Code) <span class="text-destructive">*</span>
				</label>
				<Input
					id="uom-code"
					type="text"
					bind:value={createCode}
					placeholder="เช่น can, pack, cylinder"
					class="h-10 rounded-xl font-mono text-xs"
				/>
				<p class="mt-1 text-2xs text-muted-foreground">
					เฉพาะอักษรภาษาอังกฤษตัวพิมพ์เล็กและตัวเลข (a-z, 0-9, _) 1-16 ตัวอักษร
				</p>
				{#if createErrors.code}
					<p class="mt-1 text-2xs font-semibold text-destructive">{createErrors.code}</p>
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label
						for="uom-label-th"
						class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
					>
						ชื่อภาษาไทย <span class="text-destructive">*</span>
					</label>
					<Input
						id="uom-label-th"
						type="text"
						bind:value={createLabelTh}
						placeholder="เช่น กระป๋อง"
						class="h-10 rounded-xl text-xs"
					/>
					{#if createErrors.label_th}
						<p class="mt-1 text-2xs font-semibold text-destructive">{createErrors.label_th}</p>
					{/if}
				</div>
				<div>
					<label
						for="uom-label-th-short"
						class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
					>
						ชื่อย่อภาษาไทย
					</label>
					<Input
						id="uom-label-th-short"
						type="text"
						bind:value={createLabelThShort}
						placeholder="เช่น กก., ล."
						class="h-10 rounded-xl text-xs"
					/>
				</div>
			</div>

			<div>
				<label
					for="uom-label-en"
					class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
				>
					ชื่อภาษาอังกฤษ <span class="text-destructive">*</span>
				</label>
				<Input
					id="uom-label-en"
					type="text"
					bind:value={createLabelEn}
					placeholder="เช่น can, kilogram"
					class="h-10 rounded-xl text-xs"
				/>
				{#if createErrors.label_en}
					<p class="mt-1 text-2xs font-semibold text-destructive">{createErrors.label_en}</p>
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label
						for="uom-dimension"
						class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
					>
						มิติการวัด (Dimension) <span class="text-destructive">*</span>
					</label>
					<Select.Root
						type="single"
						value={createDimension}
						onValueChange={(value) => {
							if (value) createDimension = value as Dimension;
						}}
					>
						<Select.Trigger id="uom-dimension" class="h-10 w-full rounded-xl text-xs">
							{DIMENSION_LABELS[createDimension]?.th} ({createDimension})
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="count">จำนวนนับ (count)</Select.Item>
							<Select.Item value="mass">น้ำหนัก (mass)</Select.Item>
							<Select.Item value="volume">ปริมาตร (volume)</Select.Item>
							<Select.Item value="length">ความยาว (length)</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<label
						for="uom-sort-order"
						class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
					>
						ลำดับการแสดงผล
					</label>
					<Input
						id="uom-sort-order"
						type="number"
						bind:value={createSortOrder}
						min="1"
						class="h-10 rounded-xl text-xs tabular-nums"
					/>
				</div>
			</div>
		</div>

		<div class="mt-6 flex justify-end gap-2">
			<Button
				variant="outline"
				size="sm"
				onclick={() => (createDialogOpen = false)}
				class="rounded-xl text-xs"
			>
				ยกเลิก
			</Button>
			<Button
				size="sm"
				disabled={createMutation.isPending}
				onclick={handleCreate}
				class="rounded-xl text-xs font-bold"
			>
				{createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกหน่วยนับ'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- EDIT DIALOG -->
<Dialog.Root bind:open={editDialogOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[480px]">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold text-slate-800 dark:text-slate-100">
				แก้ไขหน่วยนับ: <span class="font-mono text-primary">{editingUnit?.code}</span>
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				ปรับปรุงชื่อเรียกและสถานะการใช้งานของหน่วยนับ
			</Dialog.Description>
		</Dialog.Header>

		<div class="mt-4 space-y-4">
			<div>
				<label
					for="edit-unit-code"
					class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
				>
					รหัสหน่วย (Unit Code)
				</label>
				<Input
					id="edit-unit-code"
					value={editingUnit?.code}
					disabled
					class="h-10 rounded-xl font-mono text-xs disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-800"
				/>
				<p class="mt-1 text-2xs text-muted-foreground">
					รหัสหน่วยใช้เป็นคีย์อ้างอิงในฐานข้อมูล ไม่สามารถแก้ไขได้
				</p>
			</div>

			<div>
				<label
					for="edit-uom-label-th"
					class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
				>
					ชื่อภาษาไทย <span class="text-destructive">*</span>
				</label>
				<Input
					id="edit-uom-label-th"
					type="text"
					bind:value={editLabelTh}
					class="h-10 rounded-xl text-xs"
				/>
				{#if editErrors.label_th}
					<p class="mt-1 text-2xs font-semibold text-destructive">{editErrors.label_th}</p>
				{/if}
			</div>

			<div>
				<label
					for="edit-uom-label-th-short"
					class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
				>
					ชื่อย่อภาษาไทย
				</label>
				<Input
					id="edit-uom-label-th-short"
					type="text"
					bind:value={editLabelThShort}
					class="h-10 rounded-xl text-xs"
				/>
			</div>

			<div>
				<label
					for="edit-uom-label-en"
					class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
				>
					ชื่อภาษาอังกฤษ <span class="text-destructive">*</span>
				</label>
				<Input
					id="edit-uom-label-en"
					type="text"
					bind:value={editLabelEn}
					class="h-10 rounded-xl text-xs"
				/>
				{#if editErrors.label_en}
					<p class="mt-1 text-2xs font-semibold text-destructive">{editErrors.label_en}</p>
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label
						for="edit-unit-dimension"
						class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
					>
						มิติการวัด (Dimension)
					</label>
					<Input
						id="edit-unit-dimension"
						value={DIMENSION_LABELS[editingUnit?.dimension ?? 'count']?.th ??
							editingUnit?.dimension}
						disabled
						class="h-10 rounded-xl text-xs disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-zinc-800"
					/>
					<p class="mt-1 text-2xs text-muted-foreground">มิติการวัดไม่สามารถแก้ไขได้</p>
				</div>
				<div>
					<label
						for="edit-uom-sort-order"
						class="mb-1 block text-xs font-bold text-slate-800 dark:text-slate-200"
					>
						ลำดับการแสดงผล
					</label>
					<Input
						id="edit-uom-sort-order"
						type="number"
						bind:value={editSortOrder}
						min="1"
						class="h-10 rounded-xl text-xs tabular-nums"
					/>
				</div>
			</div>

			<div
				class="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30"
			>
				<label class="flex cursor-pointer items-start gap-2.5">
					<Checkbox bind:checked={editDeactivated} class="mt-0.5" />
					<div class="text-xs">
						<span class="font-bold text-slate-800 dark:text-slate-200"
							>ปิดการใช้งานหน่วยนี้ (Deactivate)</span
						>
						<p class="text-2xs text-muted-foreground">
							หน่วยที่ปิดใช้งานจะไม่ปรากฏให้เลือกในฟอร์มสร้างสินค้าใหม่
							แต่ยังคงแสดงผลในรายการสินค้าเดิมได้อย่างถูกต้อง
						</p>
					</div>
				</label>
			</div>
		</div>

		<div class="mt-6 flex justify-end gap-2">
			<Button
				variant="outline"
				size="sm"
				onclick={() => (editDialogOpen = false)}
				class="rounded-xl text-xs"
			>
				ยกเลิก
			</Button>
			<Button
				size="sm"
				disabled={updateMutation.isPending}
				onclick={handleUpdate}
				class="rounded-xl text-xs font-bold"
			>
				{updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- DELETE CONFIRM DIALOG -->
<Dialog.Root bind:open={deleteConfirmOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold text-destructive">ยืนยันการลบหน่วยนับ</Dialog.Title>
			<Dialog.Description class="pt-2 text-xs text-muted-foreground">
				คุณแน่ใจหรือไม่ว่าต้องการลบหน่วยนับ <strong class="font-mono text-foreground"
					>{pendingDeleteUnit?.code}</strong
				>
				({pendingDeleteUnit?.label_th})?
				<span class="mt-2 block text-2xs text-amber-700 dark:text-amber-400">
					* โปรดตรวจสอบให้แน่ใจว่าไม่มีรายการสินค้าในแคตตาล็อกกำลังอ้างอิงหน่วยนับนี้
				</span>
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-4 flex justify-end gap-2">
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => {
					deleteConfirmOpen = false;
					pendingDeleteUnit = null;
				}}
				class="rounded-xl text-xs"
			>
				ยกเลิก
			</Button>
			<Button
				variant="destructive"
				size="sm"
				disabled={deleteMutation.isPending}
				onclick={confirmDelete}
				class="rounded-xl text-xs font-bold"
			>
				{deleteMutation.isPending ? 'กำลังลบ...' : 'ยืนยันการลบ'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

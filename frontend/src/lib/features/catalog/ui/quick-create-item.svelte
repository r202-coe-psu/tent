<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { langState } from '$lib/states/i18n.svelte';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { ItemMaster, StorageType } from '../domain/catalog';
	import { formatUnit } from '../domain/unit-of-measure';
	import { findSimilarItems } from '../domain/item-similarity';
	import {
		buildQuickCreateInput,
		quickCreateTypeClass,
		validateQuickCreate,
		QUICK_CREATE_DEFAULT_STORAGE,
		type QuickCreateDraft
	} from '../domain/quick-create';
	import {
		useCreateItemMaster,
		useItemCategories,
		useItemMasters,
		useUnitsOfMeasure
	} from '../application/queries';
	import { catalogOrigin, expiryRequirementHint } from '../domain/catalog';
	import { ORIGIN_LABELS } from './master/master-view';
	import ItemMasterForm from './item-master-form.svelte';

	let {
		shelterCode,
		initialName = '',
		initialBarcode = '',
		submitLabel = 'สร้างสินค้า',
		onCreated,
		onUseExisting,
		onCancel
	}: {
		shelterCode: string;
		/** Pre-filled from what the user had typed in the search box. */
		initialName?: string;
		/** Set when the item is being created from a scan that found nothing. */
		initialBarcode?: string;
		submitLabel?: string;
		onCreated: (item: ItemMaster) => void;
		/** The user picked a similar existing item instead of creating a duplicate. */
		onUseExisting: (item: ItemMaster) => void;
		onCancel: () => void;
	} = $props();

	const categoriesQuery = useItemCategories(() => shelterCode);
	const itemsQuery = useItemMasters(() => shelterCode);
	const unitsQuery = useUnitsOfMeasure();
	const createMutation = useCreateItemMaster();

	// ---------------------------------------------------------------- draft state
	let name = $state(untrack(() => initialName));
	let categoryId = $state('');
	let baseUnit = $state('');
	let showPack = $state(false);
	let packUnit = $state('');
	let packMultiplier = $state('');
	let packAsDefault = $state(true);
	let storage = $state<StorageType>(QUICK_CREATE_DEFAULT_STORAGE);
	let barcode = $state(untrack(() => initialBarcode));
	let attempted = $state(false);
	let showFullForm = $state(false);

	// ---------------------------------------------------------------- options
	const CATEGORY_CHIP_LIMIT = 7;
	const UNIT_CHIP_LIMIT = 6;
	const COMMON_UNIT_CODES = ['box', 'bottle', 'piece', 'bag', 'sachet', 'kg', 'pack', 'can'];

	const categories = $derived(
		(categoriesQuery.data ?? [])
			.filter((c) => !c.deactivated)
			.sort((a, b) => a.name.localeCompare(b.name, 'th'))
	);
	const allUnits = $derived(unitsQuery.data ?? []);
	const activeUnits = $derived(allUnits.filter((u) => !u.deactivated));
	const items = $derived(itemsQuery.data ?? []);

	const unitLabel = (code: string) => formatUnit(code, allUnits, langState.current) || code;

	/** Chips for the common choices, plus the picked one when it sits in the overflow list. */
	function chipsWithSelection<T>(
		all: readonly T[],
		preferred: readonly T[],
		selected: T | undefined
	): T[] {
		const chips = [...preferred];
		if (selected !== undefined && !chips.includes(selected) && all.includes(selected)) {
			chips.push(selected);
		}
		return chips;
	}

	const categoryChips = $derived(
		chipsWithSelection(
			categories.map((c) => c._id),
			categories.slice(0, CATEGORY_CHIP_LIMIT).map((c) => c._id),
			categoryId || undefined
		)
	);
	const categoryOverflow = $derived(
		categories
			.filter((c) => !categoryChips.includes(c._id))
			.map((c) => ({ value: c._id, label: c.name }))
	);
	const categoryName = (id: string) => categories.find((c) => c._id === id)?.name ?? id;

	const commonUnitCodes = $derived(
		COMMON_UNIT_CODES.filter((code) => activeUnits.some((u) => u.code === code)).slice(
			0,
			UNIT_CHIP_LIMIT
		)
	);
	const unitChips = $derived(
		chipsWithSelection(
			activeUnits.map((u) => u.code),
			commonUnitCodes,
			baseUnit || undefined
		)
	);
	const unitOverflow = $derived(
		activeUnits
			.filter((u) => !unitChips.includes(u.code))
			.map((u) => ({ value: u.code, label: unitLabel(u.code), keywords: [u.code, u.label_en] }))
	);
	const packUnitItems = $derived(
		activeUnits
			.filter((u) => u.code !== baseUnit)
			.map((u) => ({ value: u.code, label: unitLabel(u.code), keywords: [u.code, u.label_en] }))
	);

	const STORAGE_OPTIONS: { value: StorageType; label: string }[] = [
		{ value: 'DRY', label: 'แห้ง' },
		{ value: 'CHILLED', label: 'แช่เย็น' },
		{ value: 'FROZEN', label: 'แช่แข็ง' },
		{ value: 'CONTROLLED_MED', label: 'ยาควบคุม' }
	];

	// ---------------------------------------------------------------- derived
	const draft = $derived<QuickCreateDraft>({
		name,
		categoryId: categoryId || undefined,
		baseUnit,
		packUnit: showPack ? packUnit : undefined,
		packMultiplier,
		packAsDefault,
		storage,
		barcode
	});
	const requireCategory = $derived(categories.length > 0);
	const errors = $derived(validateQuickCreate(draft, { requireCategory }));
	const typeClass = $derived(quickCreateTypeClass(categoryId || undefined, categories));
	const similar = $derived(findSimilarItems(name, items));
	const offline = $derived(authStore.needsReauth);
	const catalogReady = $derived(!unitsQuery.isLoading && !categoriesQuery.isLoading);
	const canSubmit = $derived(catalogReady && !offline && !createMutation.isPending);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		if (Object.keys(errors).length > 0 || !canSubmit) return;

		createMutation.mutate(
			{
				input: buildQuickCreateInput(draft, categories),
				ctx: { shelterCode, createdBy: authStore.user?.name ?? 'unknown' },
				shelterCode
			},
			{
				onSuccess: (created) => onCreated(created),
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}

	function chipClass(selected: boolean): string {
		return [
			'inline-flex min-h-11 items-center rounded-full px-3.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none',
			selected
				? 'border-2 border-sky-600 bg-sky-50 font-semibold text-sky-900'
				: 'border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50'
		].join(' ');
	}

	// What the full form starts from when the user opens "ข้อมูลเสริม".
	const fullFormValues = $derived.by(() => {
		const input = buildQuickCreateInput(draft, categories);
		return {
			name: input.name,
			category: input.category,
			type_class: input.type_class,
			base_unit: input.base_unit,
			conversions: input.conversions?.map((c) => ({
				uom_name: c.uom_name,
				multiplier: String(c.multiplier),
				barcode: c.barcode
			})),
			default_inventory_uom: input.default_inventory_uom,
			storage_type: input.storage_type
		};
	});
</script>

{#if showFullForm}
	<div class="space-y-4">
		<Button
			type="button"
			variant="ghost"
			class="-ml-2 min-h-11 px-2 text-sm font-semibold text-sky-800"
			onclick={() => (showFullForm = false)}
		>
			← กลับไปฟอร์มย่อ
		</Button>
		<ItemMasterForm
			compact
			initialValues={fullFormValues}
			onsuccess={(item) => (item ? onCreated(item) : (showFullForm = false))}
		/>
	</div>
{:else}
	<form onsubmit={submit} class="space-y-5" novalidate>
		<div class="space-y-1.5">
			<Label for="qc-name" class="text-sm font-semibold text-slate-900">
				ชื่อสินค้า <span class="text-destructive" aria-hidden="true">*</span>
			</Label>
			<Input
				id="qc-name"
				bind:value={name}
				autocomplete="off"
				aria-invalid={attempted && !!errors.name}
				class="min-h-12 rounded-lg text-base"
			/>
			{#if attempted && errors.name}
				<p class="text-xs font-semibold text-destructive">{errors.name}</p>
			{/if}

			{#if similar.length > 0}
				<div
					class="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
					role="status"
				>
					<p class="flex items-center gap-2 font-semibold">
						<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
						มีสินค้าชื่อคล้ายกัน ใช่ตัวเดียวกันไหม
					</p>
					<ul class="space-y-1.5">
						{#each similar as match (match._id)}
							<li class="flex items-center gap-2">
								<span class="min-w-0 flex-1">
									<strong class="font-semibold">{match.name}</strong>
									<span class="text-xs">
										({ORIGIN_LABELS[catalogOrigin(match, shelterCode)]})
									</span>
								</span>
								<Button
									type="button"
									variant="outline"
									class="min-h-11 shrink-0 border-amber-600 bg-white px-3 text-sm font-bold text-amber-900"
									onclick={() => onUseExisting(match)}
								>
									ใช้ตัวนี้แทน
								</Button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<fieldset class="space-y-2">
			<legend class="text-sm font-semibold text-slate-900">
				หมวด
				{#if requireCategory}<span class="text-destructive" aria-hidden="true">*</span>{/if}
			</legend>
			{#if categoriesQuery.isLoading}
				<p class="text-sm text-slate-500">กำลังโหลดหมวด…</p>
			{:else if categories.length === 0}
				<p class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
					ยังไม่มีหมวดสินค้า สร้างสินค้านี้โดยไม่ระบุหมวดได้ แล้วเติมทีหลัง
				</p>
			{:else}
				<div class="flex flex-wrap gap-2">
					{#each categoryChips as id (id)}
						<button
							type="button"
							aria-pressed={categoryId === id}
							class={chipClass(categoryId === id)}
							onclick={() => (categoryId = id)}
						>
							{categoryName(id)}
						</button>
					{/each}
					{#if categoryOverflow.length > 0}
						<Combobox
							items={categoryOverflow}
							bind:value={() => '', (v) => v && (categoryId = v)}
							placeholder="อื่นๆ"
							searchPlaceholder="ค้นหาหมวด…"
							emptyText="ไม่พบหมวด"
							class="min-h-11 w-auto rounded-full"
						/>
					{/if}
				</div>
			{/if}
			{#if attempted && errors.category}
				<p class="text-xs font-semibold text-destructive">{errors.category}</p>
			{/if}
		</fieldset>

		<fieldset class="space-y-2">
			<legend class="text-sm font-semibold text-slate-900">
				หน่วยนับเล็กสุด <span class="text-destructive" aria-hidden="true">*</span>
				<span class="font-normal text-slate-500">ใช้เก็บยอดในระบบ</span>
			</legend>
			{#if unitsQuery.isLoading}
				<p class="text-sm text-slate-500">กำลังโหลดหน่วยนับ…</p>
			{:else if unitsQuery.isError || activeUnits.length === 0}
				<p class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
					โหลดหน่วยนับไม่สำเร็จ จึงยังสร้างสินค้าไม่ได้
				</p>
			{:else}
				<div class="flex flex-wrap gap-2">
					{#each unitChips as code (code)}
						<button
							type="button"
							aria-pressed={baseUnit === code}
							class={chipClass(baseUnit === code)}
							onclick={() => (baseUnit = code)}
						>
							{unitLabel(code)}
						</button>
					{/each}
					{#if unitOverflow.length > 0}
						<Combobox
							items={unitOverflow}
							bind:value={() => '', (v) => v && (baseUnit = v)}
							placeholder="อื่นๆ"
							searchPlaceholder="ค้นหาหน่วย…"
							emptyText="ไม่พบหน่วย"
							class="min-h-11 w-auto rounded-full"
						/>
					{/if}
				</div>
			{/if}
			{#if attempted && errors.baseUnit}
				<p class="text-xs font-semibold text-destructive">{errors.baseUnit}</p>
			{/if}
		</fieldset>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-2">
				<span class="text-sm font-semibold text-slate-900">
					ขนาดบรรจุ
					<span class="font-normal text-slate-500">(ไม่บังคับ — รับเป็นแพ็ค/ลังได้)</span>
				</span>
				{#if !showPack}
					<Button
						type="button"
						variant="ghost"
						class="min-h-11 gap-1 px-2 text-sm font-semibold text-sky-800"
						disabled={!baseUnit}
						onclick={() => (showPack = true)}
					>
						<Plus class="size-4" aria-hidden="true" />
						เพิ่มขนาดบรรจุ
					</Button>
				{/if}
			</div>
			{#if showPack}
				<div class="flex flex-wrap items-center gap-2 text-sm text-slate-700">
					<span>1</span>
					<Combobox
						items={packUnitItems}
						bind:value={packUnit}
						placeholder="หน่วย"
						searchPlaceholder="ค้นหาหน่วย…"
						emptyText="ไม่พบหน่วย"
						class="min-h-11 min-w-28 rounded-lg"
					/>
					<span>=</span>
					<Input
						type="number"
						inputmode="decimal"
						step="any"
						min={0}
						aria-label="จำนวนต่อหน่วยบรรจุ"
						bind:value={packMultiplier}
						class="min-h-11 w-24 rounded-lg text-right font-bold tabular-nums"
					/>
					<span class="font-medium">{baseUnit ? unitLabel(baseUnit) : 'หน่วยฐาน'}</span>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="ml-auto size-11 text-slate-500"
						onclick={() => {
							showPack = false;
							packUnit = '';
							packMultiplier = '';
						}}
					>
						<X class="size-4" aria-hidden="true" />
						<span class="sr-only">เอาขนาดบรรจุออก</span>
					</Button>
				</div>
				{#if packUnit}
					<div class="flex min-h-11 items-center gap-2.5">
						<Checkbox id="qc-pack-default" bind:checked={packAsDefault} />
						<Label for="qc-pack-default" class="cursor-pointer text-sm text-slate-700">
							ใช้ “{unitLabel(packUnit)}” เป็นหน่วยตั้งต้นตอนรับเข้า
						</Label>
					</div>
				{/if}
				{#if attempted && errors.pack}
					<p class="text-xs font-semibold text-destructive">{errors.pack}</p>
				{/if}
			{/if}
		</div>

		{#if typeClass === 'CONSUMABLE'}
			<fieldset class="space-y-2">
				<legend class="text-sm font-semibold text-slate-900">การเก็บรักษา</legend>
				<div class="flex flex-wrap gap-2">
					{#each STORAGE_OPTIONS as option (option.value)}
						<button
							type="button"
							aria-pressed={storage === option.value}
							class={chipClass(storage === option.value)}
							onclick={() => (storage = option.value)}
						>
							{option.label}
						</button>
					{/each}
				</div>
				<p class="text-sm text-slate-600" data-testid="expiry-requirement-hint">
					{expiryRequirementHint({ storage_type: storage })}
				</p>
			</fieldset>
		{/if}

		{#if barcode}
			<div
				class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
			>
				<span class="min-w-0 flex-1">
					บาร์โค้ดที่สแกน: <strong class="font-semibold tabular-nums">{barcode}</strong>
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-11 text-slate-500"
					onclick={() => (barcode = '')}
				>
					<X class="size-4" aria-hidden="true" />
					<span class="sr-only">ไม่ใส่บาร์โค้ด</span>
				</Button>
			</div>
		{/if}

		<button
			type="button"
			aria-expanded="false"
			onclick={() => (showFullForm = true)}
			class="flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-left text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			<span>
				ข้อมูลเสริม
				<span class="font-normal text-slate-500">
					— ประเภท, SKU, อายุเก็บรักษา, สารก่อภูมิแพ้, กลุ่มผู้รับ
				</span>
			</span>
			<ChevronDown class="size-4 shrink-0" aria-hidden="true" />
		</button>

		<p class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
			สินค้านี้จะเป็น <strong class="font-semibold text-slate-900">สินค้าของศูนย์นี้</strong> · ผู้ดูแลส่วนกลางรวมเข้าแคตตาล็อกกลางได้ภายหลัง
		</p>

		{#if offline}
			<p class="text-sm font-semibold text-amber-900" role="alert">
				เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้งก่อนสร้างสินค้า
			</p>
		{/if}

		<div class="flex justify-end gap-2 border-t border-slate-200/80 pt-4">
			<Button type="button" variant="outline" class="min-h-12 rounded-lg px-4" onclick={onCancel}>
				ยกเลิก
			</Button>
			<Button
				type="submit"
				disabled={!canSubmit}
				class="min-h-12 rounded-lg bg-[#0A2647] px-5 font-bold text-white hover:bg-[#051930]"
			>
				{createMutation.isPending ? 'กำลังสร้าง…' : submitLabel}
			</Button>
		</div>
	</form>
{/if}

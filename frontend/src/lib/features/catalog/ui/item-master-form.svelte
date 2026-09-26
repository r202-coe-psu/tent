<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		itemMasterInputSchema,
		itemMasterUpdateInputSchema,
		resolveCategoryId,
		type ItemMaster,
		type ItemMasterInput,
		type TypeClass
	} from '../domain/catalog';
	import { formatUnit, type Dimension } from '../domain/unit-of-measure';
	import {
		useItemMaster,
		useCreateItemMaster,
		useUpdateItemMaster,
		useItemCategories,
		useUnitsOfMeasure
	} from '../application/queries';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { toast } from 'svelte-sonner';
	import { langState } from '$lib/states/i18n.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let {
		id = '',
		isEdit = false,
		basePath = '/back-office/catalog',
		defaultCategoryId = undefined,
		compact = false,
		onsuccess
	}: {
		id?: string;
		isEdit?: boolean;
		basePath?: string;
		defaultCategoryId?: string;
		compact?: boolean;
		onsuccess?: () => void;
	} = $props();

	const shelterCode = $derived(
		basePath.includes('system-management') ? undefined : getShelterCode()
	);
	const validationSchema = $derived(isEdit ? itemMasterUpdateInputSchema : itemMasterInputSchema);
	const getValidationAdapter = () => zod4(validationSchema);

	const itemMasterQuery = useItemMaster(
		() => id,
		() => shelterCode ?? null
	);
	const itemCategoriesQuery = useItemCategories(() => shelterCode ?? null);
	const unitsOfMeasureQuery = useUnitsOfMeasure();
	const createMutation = useCreateItemMaster();
	const updateMutation = useUpdateItemMaster();

	const TYPE_CLASS_OPTIONS: { value: TypeClass; label: string }[] = [
		{ value: 'CONSUMABLE', label: 'วัสดุสิ้นเปลือง' },
		{ value: 'DURABLE', label: 'สิ่งของคงทน' },
		{ value: 'EQUIPMENT', label: 'อุปกรณ์' }
	];

	const DIMENSION_LABELS: Record<Dimension, string> = {
		mass: 'น้ำหนัก',
		volume: 'ปริมาตร',
		length: 'ความยาว',
		count: 'นับชิ้น'
	};

	const DIMENSION_ORDER: Dimension[] = ['mass', 'volume', 'length', 'count'];

	const form = superForm(
		defaults(
			{
				name: '',
				category: '',
				sku: '',
				description: '',
				base_unit: '',
				conversions: [] as { uom_name: string; multiplier: string; barcode: string }[],
				default_inventory_uom: '',
				default_issue_uom: '',
				distribution_type: 'recurring',
				type_class: 'CONSUMABLE' as TypeClass,
				shelf_life_days: undefined,
				storage_type: 'DRY',
				allergens: '',
				target_gender: 'ALL',
				age_group: 'ALL',
				dietary: [] as ('HALAL' | 'VEGAN')[],
				qty_per_person: undefined,
				returnable: false,
				asset_status: 'READY',
				deactivated: false,
				capacity_kg: '',
				burn_rate_kg_per_hour: '',
				time_multiplier: '1'
			},
			getValidationAdapter()
		),
		{
			SPA: true,
			dataType: 'json',
			validators: getValidationAdapter(),
			resetForm: false,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) return;

				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};

				const conversions = (validated.data.conversions || []).filter(
					(c) => c.uom_name && c.uom_name.trim() !== ''
				);

				const submitData: Record<string, unknown> = {
					...validated.data,
					conversions,
					sku: validated.data.sku || undefined,
					description: validated.data.description || undefined,
					category: validated.data.category || undefined
				};

				if (validated.data.type_class === 'CONSUMABLE') {
					submitData.base_unit = validated.data.base_unit;
					submitData.conversions = conversions;
					submitData.default_inventory_uom = validated.data.default_inventory_uom || undefined;
					submitData.default_issue_uom = validated.data.default_issue_uom || undefined;
					submitData.distribution_type = validated.data.distribution_type;

					delete submitData.qty_per_person;
					delete submitData.returnable;
					delete submitData.asset_status;

					if (validated.data.category === 'item_category:fuel_energy') {
						// FUEL_ENERGY contract (CR-119/120/125): lock base_unit, hide/don't
						// persist unrelated food/distribution fields, persist fuel spec.
						submitData.base_unit = 'cylinder';
						submitData.fuel_type = 'LPG';
						submitData.capacity_kg = validated.data.capacity_kg || undefined;
						submitData.burn_rate_kg_per_hour = validated.data.burn_rate_kg_per_hour || undefined;
						submitData.time_multiplier = validated.data.time_multiplier || '1';

						delete submitData.shelf_life_days;
						delete submitData.storage_type;
						delete submitData.allergens;
						delete submitData.target_gender;
						delete submitData.age_group;
						submitData.dietary = [];
					} else {
						submitData.shelf_life_days = validated.data.shelf_life_days;
						submitData.storage_type = validated.data.storage_type;
						submitData.allergens = validated.data.allergens || undefined;
						submitData.target_gender = validated.data.target_gender;
						submitData.age_group = validated.data.age_group;
						submitData.dietary = validated.data.dietary;

						delete submitData.fuel_type;
						delete submitData.capacity_kg;
						delete submitData.burn_rate_kg_per_hour;
						delete submitData.time_multiplier;
					}
				} else if (validated.data.type_class === 'DURABLE') {
					submitData.base_unit = validated.data.base_unit;
					submitData.conversions = conversions;
					submitData.default_inventory_uom = validated.data.default_inventory_uom || undefined;
					submitData.default_issue_uom = validated.data.default_issue_uom || undefined;
					submitData.distribution_type = validated.data.distribution_type;
					submitData.qty_per_person = validated.data.qty_per_person;
					submitData.returnable = validated.data.returnable;
					submitData.target_gender = validated.data.target_gender;
					submitData.age_group = validated.data.age_group;

					delete submitData.shelf_life_days;
					delete submitData.storage_type;
					delete submitData.allergens;
					submitData.dietary = [];
					delete submitData.asset_status;
					delete submitData.fuel_type;
					delete submitData.capacity_kg;
					delete submitData.burn_rate_kg_per_hour;
					delete submitData.time_multiplier;
				} else if (validated.data.type_class === 'EQUIPMENT') {
					submitData.base_unit = validated.data.base_unit || 'piece';
					submitData.asset_status = validated.data.asset_status || 'READY';

					delete submitData.conversions;
					delete submitData.default_inventory_uom;
					delete submitData.default_issue_uom;
					delete submitData.distribution_type;
					delete submitData.shelf_life_days;
					delete submitData.storage_type;
					delete submitData.allergens;
					delete submitData.target_gender;
					delete submitData.age_group;
					submitData.dietary = [];
					delete submitData.qty_per_person;
					delete submitData.returnable;
					delete submitData.fuel_type;
					delete submitData.capacity_kg;
					delete submitData.burn_rate_kg_per_hour;
					delete submitData.time_multiplier;
				}

				if (isEdit) {
					if (!itemMasterQuery.data) {
						toast.error('ไม่พบข้อมูลสินค้าต้นทาง');
						return;
					}
					if (basePath.includes('back-office') && !itemMasterQuery.data.shelter_code) {
						const { _rev, ...itemData } = itemMasterQuery.data;
						void _rev;
						const overrideDoc = {
							...itemData,
							...submitData,
							shelter_code: shelterCode,
							override: true
						};
						updateMutation.mutate(overrideDoc, {
							onSuccess: () => {
								toast.success(`ปรับแต่งรายการ ${validated.data.name} สำหรับศูนย์นี้สำเร็จ`);
								onsuccess?.();
							},
							onError: (err: Error) => toast.error(err.message)
						});
					} else {
						const updatedDoc: ItemMaster = {
							...itemMasterQuery.data,
							...submitData
						};
						updateMutation.mutate(updatedDoc, {
							onSuccess: () => {
								toast.success(`ปรับปรุงข้อมูล ${validated.data.name} สำเร็จ`);
								onsuccess?.();
							},
							onError: (err: Error) => toast.error(err.message)
						});
					}
				} else {
					createMutation.mutate(
						{ input: submitData as ItemMasterInput, ctx, shelterCode },
						{
							onSuccess: () => {
								toast.success(`เพิ่มข้อมูล ${validated.data.name} สำเร็จ`);
								onsuccess?.();
							},
							onError: (err: Error) => toast.error(err.message)
						}
					);
				}
			}
		}
	);

	const { form: formData, submitting } = form;

	$effect(() => {
		form.options.validators = getValidationAdapter();
	});

	let populatedId = $state<string | null>(null);
	let appliedDefaultCategory = $state(false);

	$effect(() => {
		if (isEdit && itemMasterQuery.data && populatedId !== itemMasterQuery.data._id) {
			const item = itemMasterQuery.data;
			populatedId = item._id;
			const cats = itemCategoriesQuery.data ?? [];
			const resolvedCat = resolveCategoryId(item.category, cats) ?? item.category ?? '';
			$formData.name = item.name || '';
			$formData.category = resolvedCat;
			$formData.sku = item.sku || '';
			$formData.description = item.description || '';
			$formData.base_unit = item.base_unit || '';
			$formData.conversions =
				item.conversions && item.conversions.length > 0
					? JSON.parse(JSON.stringify(item.conversions))
					: [];
			$formData.default_inventory_uom = item.default_inventory_uom || '';
			$formData.default_issue_uom = item.default_issue_uom || '';
			$formData.distribution_type = item.distribution_type || 'recurring';
			$formData.type_class = item.type_class || 'CONSUMABLE';
			$formData.shelf_life_days = item.shelf_life_days;
			$formData.storage_type = item.storage_type || 'DRY';
			$formData.allergens = item.allergens || '';
			$formData.target_gender = item.target_gender || 'ALL';
			$formData.age_group = item.age_group || 'ALL';
			$formData.dietary = item.dietary || [];
			$formData.qty_per_person = item.qty_per_person;
			$formData.returnable = item.returnable ?? false;
			$formData.asset_status = item.asset_status || 'READY';
			$formData.deactivated = item.deactivated ?? false;
			$formData.capacity_kg = item.capacity_kg || '';
			$formData.burn_rate_kg_per_hour = item.burn_rate_kg_per_hour || '';
			$formData.time_multiplier = item.time_multiplier || '1';
		}
	});

	// Prefill category + type_class on create
	$effect(() => {
		if (isEdit || appliedDefaultCategory) return;
		const cats = itemCategoriesQuery.data ?? [];
		if (!defaultCategoryId && cats.length === 0) return;

		const catId = defaultCategoryId ?? '';
		if (catId) {
			$formData.category = catId;
			const cat = cats.find((c) => c._id === catId);
			if (cat?.default_class) {
				$formData.type_class = cat.default_class;
			}
			appliedDefaultCategory = true;
		}
	});

	function onCategoryChange(catId: string) {
		$formData.category = catId;
		const cat = availableCategories.find((c) => c._id === catId);
		if (cat?.default_class) {
			$formData.type_class = cat.default_class;
		}
	}

	const isLoading = $derived(isEdit ? itemMasterQuery.isLoading : false);
	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);

	const allUnits = $derived(unitsOfMeasureQuery.data ?? []);
	const activeUnits = $derived.by(() => {
		const selectedCodes = [
			$formData.base_unit,
			$formData.default_inventory_uom,
			$formData.default_issue_uom,
			...($formData.conversions ?? []).map((conversion) => conversion.uom_name)
		].filter((code): code is string => Boolean(code));
		const list = allUnits.filter((unit) => !unit.deactivated || selectedCodes.includes(unit.code));
		const missing = selectedCodes
			.filter((code, index, codes) => code && !codes.slice(0, index).includes(code))
			.filter((code) => !list.some((unit) => unit.code === code))
			.map((code) => ({
				_id: `legacy-unit:${code}`,
				type: 'unit_of_measure' as const,
				schema_v: 1,
				code,
				label_th: formatUnit(code, allUnits, langState.current),
				label_en: formatUnit(code, allUnits, 'en'),
				dimension: 'count' as const,
				deactivated: true,
				created_at: '',
				updated_at: '',
				created_by: ''
			}));
		return [...list, ...missing];
	});

	const unitsByDimension = $derived.by(() => {
		const groups: { dimension: Dimension; label: string; units: typeof activeUnits }[] = [];
		for (const dim of DIMENSION_ORDER) {
			const units = activeUnits.filter((u) => u.dimension === dim);
			if (units.length > 0) {
				groups.push({ dimension: dim, label: DIMENSION_LABELS[dim], units });
			}
		}
		return groups;
	});

	const unitMasterReady = $derived(
		!unitsOfMeasureQuery.isLoading && !unitsOfMeasureQuery.isError && allUnits.length > 0
	);

	const availableCategories = $derived.by(() => {
		return (itemCategoriesQuery.data ?? []).filter(
			(cat) => !cat.deactivated || cat._id === $formData.category
		);
	});

	const selectedCategory = $derived(availableCategories.find((c) => c._id === $formData.category));

	const isFuelEnergy = $derived(
		selectedCategory?.system_key === 'FUEL_ENERGY' ||
			$formData.category === 'item_category:fuel_energy'
	);

	const showUnits = $derived(
		$formData.type_class === 'CONSUMABLE' || $formData.type_class === 'DURABLE'
	);

	const baseUnitLabel = $derived(
		activeUnits.find((u) => u.code === $formData.base_unit)?.label_th ||
			formatUnit($formData.base_unit, allUnits, langState.current) ||
			'หน่วยฐาน'
	);

	function usedUomCodes(exceptIndex?: number): string[] {
		const codes: string[] = [];
		if ($formData.base_unit) codes.push($formData.base_unit);
		($formData.conversions ?? []).forEach((c, i) => {
			if (exceptIndex !== undefined && i === exceptIndex) return;
			if (c.uom_name) codes.push(c.uom_name);
		});
		return codes;
	}

	function addConversion() {
		$formData.conversions = [
			...($formData.conversions ?? []),
			{ uom_name: '', multiplier: '1', barcode: '' }
		];
	}

	function removeConversion(index: number) {
		const removed = $formData.conversions[index]?.uom_name;
		$formData.conversions = $formData.conversions.filter((_, i) => i !== index);
		if (removed && $formData.default_inventory_uom === removed) {
			$formData.default_inventory_uom = '';
		}
		if (removed && $formData.default_issue_uom === removed) {
			$formData.default_issue_uom = '';
		}
	}

	function packChoices(): { code: string; label: string }[] {
		const choices: { code: string; label: string }[] = [];
		if ($formData.base_unit) {
			choices.push({ code: $formData.base_unit, label: baseUnitLabel });
		}
		for (const c of $formData.conversions ?? []) {
			if (!c.uom_name || choices.some((choice) => choice.code === c.uom_name)) continue;
			const label =
				activeUnits.find((u) => u.code === c.uom_name)?.label_th ??
				formatUnit(c.uom_name, allUnits, langState.current);
			choices.push({ code: c.uom_name, label });
		}
		return choices;
	}

	const fieldClass = $derived(compact ? 'space-y-2' : 'space-y-2');
	const sectionClass = $derived(
		compact
			? 'space-y-4 rounded-xl border border-border/80 bg-muted/30 p-4'
			: 'space-y-5 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30'
	);
</script>

{#if isLoading}
	<div class="py-12 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลสินค้า...</div>
{:else}
	<form method="POST" use:form.enhance class="space-y-5">
		{#if unitsOfMeasureQuery.isError}
			<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
				โหลดหน่วยนับไม่สำเร็จ จึงยังไม่สามารถบันทึกรายการได้
			</div>
		{:else if !unitsOfMeasureQuery.isLoading && allUnits.length === 0}
			<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
				ไม่พบหน่วยนับมาตรฐาน กรุณาให้ผู้ดูแลระบบเตรียมหน่วยนับก่อน
			</div>
		{/if}

		<Field.FieldGroup class="space-y-5">
			<section class={sectionClass}>
				<h2 class="text-sm font-bold text-foreground">รายการสินค้า</h2>

				<Form.Field {form} name="name" class={fieldClass}>
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold">
								ชื่อ <span class="text-destructive">*</span>
							</Form.Label>
							<Input
								{...props}
								bind:value={$formData.name}
								placeholder="เช่น ข้าวสาร, น้ำดื่ม"
								class="h-11 rounded-xl"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="text-xs font-semibold text-destructive" />
				</Form.Field>

				<Form.Field {form} name="category" class={fieldClass}>
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold">หมวดสินค้า</Form.Label>
							<select
								{...props}
								value={$formData.category}
								onchange={(e) => onCategoryChange(e.currentTarget.value)}
								class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
							>
								<option value="">-- เลือกหมวด --</option>
								{#each availableCategories as cat (cat._id)}
									<option value={cat._id}>
										{cat.name}{cat.deactivated ? ' (ปิดใช้งาน)' : ''}
									</option>
								{/each}
							</select>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="text-xs font-semibold text-destructive" />
				</Form.Field>

				<Form.Field {form} name="type_class" class={fieldClass}>
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold">
								ประเภท <span class="text-destructive">*</span>
							</Form.Label>
							<input type="hidden" {...props} bind:value={$formData.type_class} />
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
								{#each TYPE_CLASS_OPTIONS as opt (opt.value)}
									<button
										type="button"
										onclick={() => ($formData.type_class = opt.value)}
										class="rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors {$formData.type_class ===
										opt.value
											? 'border-primary bg-primary/5 ring-1 ring-primary'
											: 'border-border hover:bg-muted/60'}"
									>
										{opt.label}
									</button>
								{/each}
							</div>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="text-xs font-semibold text-destructive" />
				</Form.Field>

				{#if !compact}
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Form.Field {form} name="sku" class={fieldClass}>
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold">รหัสสินค้า</Form.Label>
									<Input {...props} bind:value={$formData.sku} class="h-11 rounded-xl" />
								{/snippet}
							</Form.Control>
						</Form.Field>
						<Form.Field {form} name="description" class={fieldClass}>
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold">รายละเอียด</Form.Label>
									<Input {...props} bind:value={$formData.description} class="h-11 rounded-xl" />
								{/snippet}
							</Form.Control>
						</Form.Field>
					</div>
				{/if}
			</section>

			{#if showUnits}
				<section class={sectionClass}>
					<h2 class="text-sm font-bold text-foreground">หน่วย</h2>

					<Form.Field {form} name="base_unit" class={fieldClass}>
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-sm font-semibold">
									หน่วยฐาน <span class="text-destructive">*</span>
								</Form.Label>
								<Select.Root
									type="single"
									value={$formData.base_unit}
									onValueChange={(value) => ($formData.base_unit = value)}
									disabled={isEdit || !unitMasterReady}
								>
									<Select.Trigger {...props} class="h-11 w-full rounded-xl">
										{activeUnits.find((u) => u.code === $formData.base_unit)?.label_th ??
											'-- เลือกหน่วย --'}
									</Select.Trigger>
									<Select.Content>
										{#each unitsByDimension as group (group.dimension)}
											<div class="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
												{group.label}
											</div>
											{#each group.units as unit (unit.code)}
												<Select.Item value={unit.code} label={unit.label_th}>
													{unit.label_th}
												</Select.Item>
											{/each}
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="text-xs font-semibold text-destructive" />
					</Form.Field>

					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<span class="text-sm font-semibold">หน่วยแปลง</span>
							<Button
								type="button"
								size="sm"
								variant="outline"
								class="h-8 gap-1"
								onclick={addConversion}
								disabled={!unitMasterReady || !$formData.base_unit}
							>
								<Plus class="h-3.5 w-3.5" />
								เพิ่ม
							</Button>
						</div>

						{#each $formData.conversions as conversion, i (i)}
							{@const taken = usedUomCodes(i)}
							<div class="space-y-2 rounded-xl border border-border bg-background p-3">
								<div class="flex flex-wrap items-center gap-2 text-sm">
									<span class="text-muted-foreground">1</span>
									<Select.Root
										type="single"
										value={conversion.uom_name}
										onValueChange={(value) => {
											$formData.conversions[i].uom_name = value;
										}}
										disabled={!unitMasterReady}
									>
										<Select.Trigger class="h-10 min-w-[7rem] rounded-lg">
											{activeUnits.find((u) => u.code === conversion.uom_name)?.label_th ?? 'หน่วย'}
										</Select.Trigger>
										<Select.Content>
											{#each unitsByDimension as group (group.dimension)}
												<div class="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
													{group.label}
												</div>
												{#each group.units as unit (unit.code)}
													{#if !taken.includes(unit.code) || unit.code === conversion.uom_name}
														<Select.Item value={unit.code} label={unit.label_th}>
															{unit.label_th}
														</Select.Item>
													{/if}
												{/each}
											{/each}
										</Select.Content>
									</Select.Root>
									<span class="text-muted-foreground">=</span>
									<Input
										type="number"
										step="any"
										min={0}
										value={conversion.multiplier}
										oninput={(e) => {
											const val = e.currentTarget.value;
											$formData.conversions[i].multiplier = val === '' ? '1' : val;
										}}
										class="h-10 w-24 rounded-lg"
									/>
									<span class="font-medium">{baseUnitLabel}</span>
									<Button
										type="button"
										size="icon"
										variant="ghost"
										class="ml-auto h-8 w-8 text-destructive"
										onclick={() => removeConversion(i)}
									>
										<Trash2 class="h-4 w-4" />
									</Button>
								</div>
								<div class="flex flex-wrap gap-2">
									<button
										type="button"
										class="rounded-full border px-2.5 py-1 text-xs transition-colors {$formData.default_inventory_uom ===
										conversion.uom_name
											? 'border-primary bg-primary/10 font-semibold text-primary'
											: 'border-border text-muted-foreground hover:bg-muted'}"
										onclick={() => {
											$formData.default_inventory_uom =
												$formData.default_inventory_uom === conversion.uom_name
													? ''
													: conversion.uom_name;
										}}
										disabled={!conversion.uom_name}
									>
										หน่วยรับเข้า
									</button>
									<button
										type="button"
										class="rounded-full border px-2.5 py-1 text-xs transition-colors {$formData.default_issue_uom ===
										conversion.uom_name
											? 'border-primary bg-primary/10 font-semibold text-primary'
											: 'border-border text-muted-foreground hover:bg-muted'}"
										onclick={() => {
											$formData.default_issue_uom =
												$formData.default_issue_uom === conversion.uom_name
													? ''
													: conversion.uom_name;
										}}
										disabled={!conversion.uom_name}
									>
										หน่วยเบิกจ่าย
									</button>
								</div>
							</div>
						{/each}

						{#if $formData.base_unit}
							<div class="flex flex-wrap gap-2 pt-1">
								<span class="w-full text-xs text-muted-foreground"
									>หรือใช้หน่วยฐานเป็นค่าเริ่มต้น:</span
								>
								{#each packChoices() as choice, choiceIndex (`${choiceIndex}-${choice.code}`)}
									<button
										type="button"
										class="rounded-full border px-2.5 py-1 text-xs transition-colors {$formData.default_inventory_uom ===
										choice.code
											? 'border-primary bg-primary/10 font-semibold text-primary'
											: 'border-border text-muted-foreground hover:bg-muted'}"
										onclick={() => ($formData.default_inventory_uom = choice.code)}
									>
										รับเข้า: {choice.label}
									</button>
									<button
										type="button"
										class="rounded-full border px-2.5 py-1 text-xs transition-colors {$formData.default_issue_uom ===
										choice.code
											? 'border-primary bg-primary/10 font-semibold text-primary'
											: 'border-border text-muted-foreground hover:bg-muted'}"
										onclick={() => ($formData.default_issue_uom = choice.code)}
									>
										เบิกจ่าย: {choice.label}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</section>
			{/if}

			{#if isFuelEnergy}
				<section class={sectionClass}>
					<h2 class="text-sm font-bold text-foreground">เชื้อเพลิงและพลังงาน</h2>

					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Form.Field {form} name="capacity_kg" class={fieldClass}>
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold">
										ความจุถัง (กก.) <span class="text-destructive">*</span>
									</Form.Label>
									<Input
										{...props}
										type="number"
										step="any"
										min={0}
										bind:value={$formData.capacity_kg}
										class="h-11 rounded-xl"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="text-xs font-semibold text-destructive" />
						</Form.Field>

						<Form.Field {form} name="burn_rate_kg_per_hour" class={fieldClass}>
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold">
										อัตราสิ้นเปลืองแก๊ส (กก./ชม.) <span class="text-destructive">*</span>
									</Form.Label>
									<Input
										{...props}
										type="number"
										step="any"
										min={0}
										bind:value={$formData.burn_rate_kg_per_hour}
										class="h-11 rounded-xl"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="text-xs font-semibold text-destructive" />
						</Form.Field>

						<Form.Field {form} name="time_multiplier" class={fieldClass}>
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold"
										>ตัวคูณเวลาปรุง (Time Multiplier)</Form.Label
									>
									<Input
										{...props}
										type="number"
										step="any"
										min={0}
										bind:value={$formData.time_multiplier}
										class="h-11 rounded-xl"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="text-xs font-semibold text-destructive" />
						</Form.Field>
					</div>
				</section>
			{/if}

			{#if !isFuelEnergy && ($formData.type_class === 'CONSUMABLE' || $formData.type_class === 'DURABLE' || $formData.type_class === 'EQUIPMENT')}
				<details class="rounded-xl border border-border open:bg-muted/20" open={!compact}>
					<summary class="cursor-pointer px-4 py-3 text-sm font-semibold">
						รายละเอียดเพิ่มเติม
					</summary>
					<div class="space-y-4 border-t border-border px-4 py-4">
						{#if $formData.type_class === 'CONSUMABLE'}
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Form.Field {form} name="shelf_life_days" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">อายุเก็บรักษา (วัน)</Form.Label>
											<Input
												{...props}
												type="number"
												value={$formData.shelf_life_days ?? ''}
												oninput={(e) => {
													const val = e.currentTarget.value;
													$formData.shelf_life_days = val === '' ? undefined : Number(val);
												}}
												class="h-11 rounded-xl"
											/>
										{/snippet}
									</Form.Control>
								</Form.Field>

								<Form.Field {form} name="storage_type" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">การจัดเก็บ</Form.Label>
											<select
												{...props}
												bind:value={$formData.storage_type}
												class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
											>
												<option value="DRY">ของแห้ง</option>
												<option value="CHILLED">แช่เย็น</option>
												<option value="FROZEN">แช่แข็ง</option>
												<option value="CONTROLLED_MED">ควบคุมพิเศษ/ยา</option>
											</select>
										{/snippet}
									</Form.Control>
								</Form.Field>

								{#if !isFuelEnergy}
									<Form.Field {form} name="allergens" class={fieldClass}>
										<Form.Control>
											{#snippet children({ props })}
												<Form.Label class="text-sm font-semibold">สารก่อภูมิแพ้</Form.Label>
												<Input
													{...props}
													bind:value={$formData.allergens}
													placeholder="เช่น ถั่ว, นม"
													class="h-11 rounded-xl"
												/>
											{/snippet}
										</Form.Control>
									</Form.Field>

									<Form.Field {form} name="dietary" class={fieldClass}>
										<Form.Control>
											{#snippet children({ props })}
												<Form.Label class="text-sm font-semibold">ข้อจำกัดด้านอาหาร</Form.Label>
												<select
													{...props}
													value={$formData.dietary?.[0] ?? 'NONE'}
													onchange={(e) => {
														const val = e.currentTarget.value;
														$formData.dietary = val === 'NONE' ? [] : [val as 'HALAL' | 'VEGAN'];
													}}
													class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
												>
													<option value="NONE">ไม่มี</option>
													<option value="HALAL">ฮาลาล</option>
													<option value="VEGAN">วีแกน</option>
												</select>
											{/snippet}
										</Form.Control>
									</Form.Field>
								{/if}

								<Form.Field {form} name="target_gender" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">เพศที่ใช้ได้</Form.Label>
											<select
												{...props}
												bind:value={$formData.target_gender}
												class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
											>
												<option value="ALL">ทุกเพศ</option>
												<option value="MALE">ชาย</option>
												<option value="FEMALE">หญิง</option>
											</select>
										{/snippet}
									</Form.Control>
								</Form.Field>

								<Form.Field {form} name="age_group" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">ช่วงวัย</Form.Label>
											<select
												{...props}
												bind:value={$formData.age_group}
												class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
											>
												<option value="ALL">ทุกวัย</option>
												<option value="INFANT">ทารก</option>
												<option value="CHILD">เด็ก</option>
												<option value="ELDERLY">ผู้สูงอายุ</option>
											</select>
										{/snippet}
									</Form.Control>
								</Form.Field>

								<Form.Field {form} name="distribution_type" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">ประเภทการแจก</Form.Label>
											<select
												{...props}
												bind:value={$formData.distribution_type}
												class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
											>
												<option value="recurring">แจกซ้ำได้ตามรอบ</option>
												<option value="one_time">แจกครั้งเดียวต่อคน</option>
											</select>
										{/snippet}
									</Form.Control>
								</Form.Field>
							</div>
						{:else if $formData.type_class === 'DURABLE'}
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Form.Field {form} name="qty_per_person" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">จำนวนต่อคน</Form.Label>
											<Input
												{...props}
												type="number"
												step="any"
												min={0}
												value={$formData.qty_per_person ?? ''}
												oninput={(e) => {
													const val = e.currentTarget.value;
													$formData.qty_per_person = val === '' ? undefined : Number(val);
												}}
												class="h-11 rounded-xl"
											/>
										{/snippet}
									</Form.Control>
								</Form.Field>

								<Form.Field {form} name="returnable" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<div
												class="flex h-11 items-center gap-3 rounded-xl border border-border px-3"
											>
												<Checkbox
													{...props}
													checked={$formData.returnable}
													onCheckedChange={(checked) => {
														$formData.returnable = !!checked;
													}}
												/>
												<span class="text-sm font-medium">ต้องคืนเมื่อใช้งานเสร็จ</span>
											</div>
										{/snippet}
									</Form.Control>
								</Form.Field>

								<Form.Field {form} name="target_gender" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">เพศที่ใช้ได้</Form.Label>
											<select
												{...props}
												bind:value={$formData.target_gender}
												class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
											>
												<option value="ALL">ทุกเพศ</option>
												<option value="MALE">ชาย</option>
												<option value="FEMALE">หญิง</option>
											</select>
										{/snippet}
									</Form.Control>
								</Form.Field>

								<Form.Field {form} name="age_group" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">ช่วงวัย</Form.Label>
											<select
												{...props}
												bind:value={$formData.age_group}
												class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
											>
												<option value="ALL">ทุกวัย</option>
												<option value="INFANT">ทารก</option>
												<option value="CHILD">เด็ก</option>
												<option value="ELDERLY">ผู้สูงอายุ</option>
											</select>
										{/snippet}
									</Form.Control>
								</Form.Field>

								<Form.Field {form} name="distribution_type" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">ประเภทการแจก</Form.Label>
											<select
												{...props}
												bind:value={$formData.distribution_type}
												class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
											>
												<option value="recurring">แจกซ้ำได้ตามรอบ</option>
												<option value="one_time">แจกครั้งเดียวต่อคน</option>
											</select>
										{/snippet}
									</Form.Control>
								</Form.Field>
							</div>
						{:else if $formData.type_class === 'EQUIPMENT'}
							<Form.Field {form} name="asset_status" class={fieldClass}>
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label class="text-sm font-semibold">สถานะครุภัณฑ์</Form.Label>
										<select
											{...props}
											bind:value={$formData.asset_status}
											class="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
										>
											<option value="READY">พร้อมใช้งาน</option>
											<option value="IN_USE">กำลังใช้งาน</option>
											<option value="MAINTENANCE">บำรุงรักษา</option>
											<option value="BROKEN">ชำรุด</option>
										</select>
									{/snippet}
								</Form.Control>
							</Form.Field>
						{/if}

						{#if compact}
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<Form.Field {form} name="sku" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">รหัสสินค้า</Form.Label>
											<Input {...props} bind:value={$formData.sku} class="h-11 rounded-xl" />
										{/snippet}
									</Form.Control>
								</Form.Field>
								<Form.Field {form} name="description" class={fieldClass}>
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label class="text-sm font-semibold">รายละเอียด</Form.Label>
											<Input
												{...props}
												bind:value={$formData.description}
												class="h-11 rounded-xl"
											/>
										{/snippet}
									</Form.Control>
								</Form.Field>
							</div>
						{/if}
					</div>
				</details>
			{/if}

			{#if isEdit && !compact}
				<section class={sectionClass}>
					<div class="flex items-center justify-between gap-3">
						<div class="space-y-0.5">
							<label for="deactivated-toggle" class="cursor-pointer text-sm font-semibold">
								ปิดการใช้งาน
							</label>
							<p class="text-xs text-muted-foreground">
								รายการที่ปิดจะไม่แสดงในการเลือกใหม่ แต่ประวัติเก่ายังอยู่
							</p>
						</div>
						<Checkbox
							id="deactivated-toggle"
							checked={$formData.deactivated}
							onCheckedChange={(val) => {
								$formData.deactivated = !!val;
							}}
						/>
					</div>
				</section>
			{/if}

			<div class="flex items-center gap-3 pt-1">
				<Button variant="outline" type="button" onclick={onsuccess} class="rounded-xl">
					{compact ? 'ยกเลิก' : 'ยกเลิกและย้อนกลับ'}
				</Button>
				<Button
					type="submit"
					disabled={$submitting || isPending || !unitMasterReady}
					class="rounded-xl"
				>
					{#if $submitting || isPending}
						กำลังบันทึก...
					{:else if isEdit}
						บันทึกการแก้ไข
					{:else}
						บันทึก
					{/if}
				</Button>
			</div>
		</Field.FieldGroup>
	</form>
{/if}

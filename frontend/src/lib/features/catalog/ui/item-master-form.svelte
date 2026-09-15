<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		itemMasterInputSchema,
		categoryReferenceMatches,
		isFuelEnergyCategory,
		type ItemMaster,
		type ItemMasterInput
	} from '../domain/catalog';

	import {
		useItemMaster,
		useCreateItemMaster,
		useUpdateItemMaster,
		useItemCategories
	} from '../application/queries';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { toast } from 'svelte-sonner';

	// Icons
	import Flame from '@lucide/svelte/icons/flame';

	let {
		id = '',
		isEdit = false,
		basePath = '/back-office/catalog',
		onsuccess,
		oncancel
	}: {
		id?: string;
		isEdit?: boolean;
		basePath?: string;
		onsuccess?: () => void;
		oncancel?: () => void;
	} = $props();

	const shelterCode = $derived(
		basePath.includes('system-management') ? undefined : getShelterCode()
	);

	// Data queries & mutations
	const itemMasterQuery = useItemMaster(
		() => id,
		() => shelterCode ?? null
	);
	const itemCategoriesQuery = useItemCategories(() => shelterCode ?? null);
	const createMutation = useCreateItemMaster();
	const updateMutation = useUpdateItemMaster();

	const form = superForm(
		defaults(
			{
				name: '',
				category: '',
				sku: '',
				description: '',
				base_unit: '',
				conversions: [{ uom_name: '', multiplier: '1', barcode: '' }],
				default_inventory_uom: '',
				default_issue_uom: '',
				distribution_type: 'recurring',
				type_class: 'CONSUMABLE',
				// CR-120: FUEL_ENERGY fields
				fuel_type: undefined,
				capacity_kg: undefined,
				burn_rate_kg_per_hour: undefined,
				time_multiplier: undefined,
				shelf_life_days: undefined,
				storage_type: 'DRY',
				allergens: '',
				target_gender: 'ALL',
				age_group: 'ALL',
				dietary: [],
				qty_per_person: undefined,
				returnable: false,
				asset_status: 'READY',
				deactivated: false
			},
			zod4(itemMasterInputSchema)
		),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4(itemMasterInputSchema),
			resetForm: false,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) return;

				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};

				// Clean up empty strings or values before saving
				const conversions = (validated.data.conversions || []).filter(
					(c) => c.uom_name && c.uom_name.trim() !== ''
				);

				const submitData: Record<string, unknown> = {
					name: validated.data.name.trim(),
					sku: validated.data.sku || undefined,
					description: validated.data.description || undefined,
					category: validated.data.category || undefined,
					deactivated: validated.data.deactivated ?? false
				};

				if (isFuelEnergy) {
					submitData.type_class = 'CONSUMABLE';
					submitData.base_unit = 'ถัง';
					submitData.fuel_type = 'LPG';
					submitData.capacity_kg = validated.data.capacity_kg;
					submitData.burn_rate_kg_per_hour = validated.data.burn_rate_kg_per_hour;
					submitData.time_multiplier = validated.data.time_multiplier || '1';
					submitData.conversions = conversions;
					submitData.default_inventory_uom = validated.data.default_inventory_uom || undefined;
					submitData.default_issue_uom = validated.data.default_issue_uom || undefined;
					submitData.distribution_type = validated.data.distribution_type || 'recurring';

					delete submitData.shelf_life_days;
					delete submitData.storage_type;
					delete submitData.allergens;
					delete submitData.target_gender;
					delete submitData.age_group;
					delete submitData.dietary;
					delete submitData.qty_per_person;
					delete submitData.returnable;
					delete submitData.asset_status;
				} else if (validated.data.type_class === 'CONSUMABLE') {
					submitData.type_class = 'CONSUMABLE';
					submitData.base_unit = validated.data.base_unit;
					submitData.conversions = conversions;
					submitData.default_inventory_uom = validated.data.default_inventory_uom || undefined;
					submitData.default_issue_uom = validated.data.default_issue_uom || undefined;
					submitData.distribution_type = validated.data.distribution_type;
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
					delete submitData.qty_per_person;
					delete submitData.returnable;
					delete submitData.asset_status;
				} else if (validated.data.type_class === 'DURABLE') {
					submitData.type_class = 'DURABLE';
					submitData.base_unit = validated.data.base_unit;
					submitData.conversions = conversions;
					submitData.default_inventory_uom = validated.data.default_inventory_uom || undefined;
					submitData.default_issue_uom = validated.data.default_issue_uom || undefined;
					submitData.distribution_type = validated.data.distribution_type;
					submitData.qty_per_person = validated.data.qty_per_person;
					submitData.returnable = validated.data.returnable;
					submitData.target_gender = validated.data.target_gender;
					submitData.age_group = validated.data.age_group;
					submitData.dietary = [];

					delete submitData.fuel_type;
					delete submitData.capacity_kg;
					delete submitData.burn_rate_kg_per_hour;
					delete submitData.time_multiplier;
					delete submitData.shelf_life_days;
					delete submitData.storage_type;
					delete submitData.allergens;
					delete submitData.asset_status;
				} else if (validated.data.type_class === 'EQUIPMENT') {
					submitData.type_class = 'EQUIPMENT';
					submitData.base_unit = 'ชิ้น';
					submitData.asset_status = validated.data.asset_status || 'READY';

					delete submitData.fuel_type;
					delete submitData.capacity_kg;
					delete submitData.burn_rate_kg_per_hour;
					delete submitData.time_multiplier;
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
				}

				if (isEdit) {
					if (!itemMasterQuery.data) {
						toast.error('ไม่พบข้อมูลมาสเตอร์ต้นทาง');
						return;
					}
					if (basePath.includes('back-office') && !itemMasterQuery.data.shelter_code) {
						// eslint-disable-next-line @typescript-eslint/no-unused-vars
						const { _rev, ...itemData } = itemMasterQuery.data;
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

	const { form: formData, errors, submitting } = form;

	const isFuelEnergy = $derived(isFuelEnergyCategory($formData.category, itemCategoriesQuery.data));

	let loadedId = $state<string | null>(null);

	// Populate form fields when data loads in edit mode
	$effect(() => {
		if (isEdit && itemMasterQuery.data && itemMasterQuery.data._id !== loadedId) {
			loadedId = itemMasterQuery.data._id;
			const item = itemMasterQuery.data;
			$formData.name = item.name || '';

			if (item.category) {
				const categories = itemCategoriesQuery.data ?? [];
				const matchedCat = categories.find((c) => categoryReferenceMatches(item.category!, c));
				$formData.category = matchedCat ? matchedCat._id : item.category;
			} else {
				$formData.category = '';
			}

			$formData.sku = item.sku || '';
			$formData.description = item.description || '';
			$formData.base_unit = item.base_unit || '';
			$formData.conversions =
				item.conversions && item.conversions.length > 0
					? JSON.parse(JSON.stringify(item.conversions))
					: [{ uom_name: '', multiplier: '1', barcode: '' }];
			$formData.default_inventory_uom = item.default_inventory_uom || '';
			$formData.default_issue_uom = item.default_issue_uom || '';
			$formData.distribution_type = item.distribution_type || 'recurring';
			$formData.type_class = item.type_class || 'CONSUMABLE';

			// CR-120: FUEL_ENERGY fields
			$formData.fuel_type = item.fuel_type;
			$formData.capacity_kg = item.capacity_kg;
			$formData.burn_rate_kg_per_hour = item.burn_rate_kg_per_hour;
			$formData.time_multiplier = item.time_multiplier;

			if (isFuelEnergyCategory(item.category, itemCategoriesQuery.data)) {
				$formData.type_class = 'CONSUMABLE';
				$formData.base_unit = 'ถัง';
				$formData.fuel_type = 'LPG';
				if (!$formData.time_multiplier) {
					$formData.time_multiplier = '1';
				}
			}

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
		}
	});

	// Re-resolve legacy category reference when categories load
	$effect(() => {
		const catRef = $formData.category;
		if (catRef && itemCategoriesQuery.data) {
			const matchedCat = itemCategoriesQuery.data.find((c) => categoryReferenceMatches(catRef, c));
			if (matchedCat && catRef !== matchedCat._id) {
				$formData.category = matchedCat._id;
			}
		}
	});

	function handleCategoryChange(e: Event) {
		const select = e.currentTarget as HTMLSelectElement;
		const selectedId = select.value;
		if (!selectedId) return;

		const selectedCat = itemCategoriesQuery.data?.find((c) => c._id === selectedId);
		if (selectedCat?.default_class) {
			$formData.type_class = selectedCat.default_class;
		}

		if (isFuelEnergyCategory(selectedId, itemCategoriesQuery.data)) {
			$formData.type_class = 'CONSUMABLE';
			$formData.base_unit = 'ถัง';
			$formData.fuel_type = 'LPG';
			if (!$formData.time_multiplier) {
				$formData.time_multiplier = '1';
			}
		} else {
			// Leaving FUEL_ENERGY: clear LPG-only fields
			$formData.fuel_type = undefined;
			$formData.capacity_kg = undefined;
			$formData.burn_rate_kg_per_hour = undefined;
			$formData.time_multiplier = undefined;
			if ($formData.base_unit === 'ถัง') {
				$formData.base_unit = '';
			}
		}
	}

	const isLoading = $derived(isEdit ? itemMasterQuery.isLoading : false);
	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);

	// Dynamically compute list of UOM choices for defaults in Section 4 and planning unit in Section 5
	const uomOptions = $derived(
		[$formData.base_unit, ...$formData.conversions.map((c) => c.uom_name)].filter(Boolean)
	);
</script>

{#if isLoading}
	<div class="py-12 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลสินค้า...</div>
{:else}
	<form method="POST" use:form.enhance class="space-y-6">
		<div class="space-y-5">
			<!-- Card: ข้อมูลสินค้า (Item Details) -->
			<div class="space-y-5 rounded-2xl border border-border/60 bg-muted/20 p-5 sm:p-6">
				<div class="space-y-1 border-b border-border/40 pb-3">
					<h3 class="text-sm font-semibold text-foreground">ข้อมูลสินค้า (Item Details)</h3>
					<p class="text-xs text-muted-foreground">
						ชื่อรายการ รหัสสินค้า หมวดหมู่ และการจำแนกประเภทสิ่งของ
					</p>
				</div>

				<!-- Row 1: ชื่อสินค้า & รหัสสินค้า -->
				<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
					<Field.Field>
						<Field.Label for="form-name">
							ชื่อสินค้า (Item Name) <span class="font-bold text-destructive">*</span>
						</Field.Label>
						<Input
							id="form-name"
							name="name"
							bind:value={$formData.name}
							placeholder="เช่น ข้าวหอมมะลิ 100%, น้ำดื่ม 600ml"
							class="h-9 w-full rounded-md border-input bg-background"
						/>
						{#if $errors.name}
							<Field.Error>{$errors.name}</Field.Error>
						{/if}
					</Field.Field>

					<Field.Field>
						<Field.Label for="form-sku">รหัสสินค้า (SKU)</Field.Label>
						<Input
							id="form-sku"
							name="sku"
							bind:value={$formData.sku}
							placeholder="เช่น P-001"
							class="h-9 w-full rounded-md border-input bg-background font-mono"
						/>
						{#if $errors.sku}
							<Field.Error>{$errors.sku}</Field.Error>
						{/if}
					</Field.Field>
				</Field.FieldGroup>

				<!-- Row 2: หมวดหมู่ (Category) -->
				<Field.Field>
					<Field.Label for="form-category">หมวดหมู่ (Category)</Field.Label>
					<select
						id="form-category"
						name="category"
						bind:value={$formData.category}
						onchange={handleCategoryChange}
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
					>
						<option value="" disabled selected>-- เลือกหมวดหมู่ --</option>
						{#if itemCategoriesQuery.data}
							{#each itemCategoriesQuery.data as cat (cat._id)}
								<option value={cat._id}>{cat.name}</option>
							{/each}
						{/if}
					</select>
					{#if $errors.category}
						<Field.Error>{$errors.category}</Field.Error>
					{/if}
				</Field.Field>

				<!-- Row 3: ประเภทสิ่งของ (Item Class) - อยู่ใต้ส่วนของหมวดหมู่ -->
				<div class="space-y-3 pt-1">
					<div class="flex items-center space-x-1">
						<Field.Label for="type_class" class="text-sm font-semibold text-foreground">
							ประเภทสิ่งของ (Item Class)
						</Field.Label>
						<span class="font-bold text-destructive">*</span>
					</div>
					<input type="hidden" name="type_class" bind:value={$formData.type_class} />

					<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<!-- CONSUMABLE -->
						<button
							type="button"
							onclick={() => ($formData.type_class = 'CONSUMABLE')}
							class="flex flex-col rounded-xl border p-4 text-left transition-all focus:outline-none {$formData.type_class ===
							'CONSUMABLE'
								? 'border-[#002f6c] bg-[#002f6c]/5 ring-1 ring-[#002f6c] dark:border-blue-500 dark:bg-blue-950/20'
								: 'border-border/60 bg-background/80 hover:bg-muted/50'}"
						>
							<span class="text-sm font-semibold text-foreground">CONSUMABLE</span>
							<span class="mt-1 text-xs text-muted-foreground">
								วัสดุสิ้นเปลือง / อาหาร (ใช้แล้วหมดไป มีอายุเก็บรักษา)
							</span>
						</button>

						<!-- DURABLE -->
						<button
							type="button"
							disabled={isFuelEnergy}
							onclick={() => {
								if (!isFuelEnergy) $formData.type_class = 'DURABLE';
							}}
							class="flex flex-col rounded-xl border p-4 text-left transition-all focus:outline-none {isFuelEnergy
								? 'cursor-not-allowed border-border/40 bg-muted/40 opacity-40'
								: $formData.type_class === 'DURABLE'
									? 'border-[#002f6c] bg-[#002f6c]/5 ring-1 ring-[#002f6c] dark:border-blue-500 dark:bg-blue-950/20'
									: 'border-border/60 bg-background/80 hover:bg-muted/50'}"
						>
							<span class="text-sm font-semibold text-foreground">DURABLE</span>
							<span class="mt-1 text-xs text-muted-foreground">
								วัสดุคงทน (ของใช้คืนได้ เช่น เต็นท์ ผ้าห่ม)
							</span>
						</button>

						<!-- EQUIPMENT -->
						<button
							type="button"
							disabled={isFuelEnergy}
							onclick={() => {
								if (!isFuelEnergy) $formData.type_class = 'EQUIPMENT';
							}}
							class="flex flex-col rounded-xl border p-4 text-left transition-all focus:outline-none {isFuelEnergy
								? 'cursor-not-allowed border-border/40 bg-muted/40 opacity-40'
								: $formData.type_class === 'EQUIPMENT'
									? 'border-[#002f6c] bg-[#002f6c]/5 ring-1 ring-[#002f6c] dark:border-blue-500 dark:bg-blue-950/20'
									: 'border-border/60 bg-background/80 hover:bg-muted/50'}"
						>
							<span class="text-sm font-semibold text-foreground">EQUIPMENT</span>
							<span class="mt-1 text-xs text-muted-foreground">
								ครุภัณฑ์ / อุปกรณ์ (รถยนต์ เครื่องสูบน้ำ เตาแก๊ส)
							</span>
						</button>
					</div>
					{#if $errors.type_class}
						<Field.Error>{$errors.type_class}</Field.Error>
					{/if}
				</div>

				<!-- Row 4: หน่วยฐาน (Base Unit) (เมื่อเป็น CONSUMABLE หรือ DURABLE) -->
				{#if $formData.type_class === 'CONSUMABLE' || $formData.type_class === 'DURABLE'}
					<Field.Field>
						<Field.Label for="form-base-unit">
							หน่วยที่เล็กที่สุด (Base Unit) <span class="font-bold text-destructive">*</span>
							{#if isFuelEnergy}
								<span class="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400">
									(ล็อคอัตโนมัติเป็น "ถัง")
								</span>
							{/if}
						</Field.Label>
						<select
							id="form-base-unit"
							name="base_unit"
							bind:value={$formData.base_unit}
							disabled={isEdit || isFuelEnergy}
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted"
						>
							<option value="" disabled selected>-- เลือกหน่วยฐาน --</option>
							{#each ['ชิ้น', 'เม็ด', 'ซอง', 'กล่อง', 'ขวด', 'กระป๋อง', 'ถุง', 'อัน', 'ชุด', 'ผืน', 'ตัว', 'คู่', 'แผ่น', 'หลอด', 'ม้วน', 'ก้อน', 'ห่อ', 'ฟอง', 'ผล', 'แกลลอน', 'ถัง', 'กรัม', 'กิโลกรัม', 'มิลลิลิตร', 'ลิตร', 'เมตร'] as unit (unit)}
								<option value={unit}>{unit}</option>
							{/each}
						</select>
						{#if $errors.base_unit}
							<Field.Error>{$errors.base_unit}</Field.Error>
						{/if}
					</Field.Field>
				{/if}

				<!-- Row 5: รายละเอียด / หมายเหตุ -->
				<Field.Field>
					<Field.Label for="form-description">รายละเอียด / หมายเหตุ (Description)</Field.Label>
					<textarea
						id="form-description"
						name="description"
						bind:value={$formData.description}
						placeholder="เช่น ข้อมูลการจัดเก็บ, จุดเด่นของสินค้า"
						rows="3"
						class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					></textarea>
					{#if $errors.description}
						<Field.Error>{$errors.description}</Field.Error>
					{/if}
				</Field.Field>
			</div>

			{#if isFuelEnergy}
				<!-- Card: คุณสมบัติแก๊สหุงต้ม LPG -->
				<div
					class="space-y-5 rounded-2xl border border-amber-200/70 bg-amber-50/40 p-5 sm:p-6 dark:border-amber-900/40 dark:bg-amber-950/20"
				>
					<div
						class="flex items-center justify-between border-b border-amber-200/60 pb-3 dark:border-amber-900/40"
					>
						<div class="flex items-center space-x-2">
							<span
								class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-800 dark:bg-amber-500/30 dark:text-amber-300"
							>
								<Flame class="h-4 w-4 text-amber-700 dark:text-amber-400" />
							</span>
							<div>
								<h3 class="text-sm font-semibold text-foreground">
									คุณสมบัติแก๊สหุงต้ม LPG (LPG Fuel Specifications)
								</h3>
								<p class="text-xs text-muted-foreground">
									พารามิเตอร์สำหรับคำนวณการใช้เชื้อเพลิงและตัดสต็อกถังแก๊ส
								</p>
							</div>
						</div>
						<span
							class="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300"
						>
							หมวดหมู่เชื้อเพลิงและพลังงาน
						</span>
					</div>

					<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
						<!-- ความจุกระบอก/ถัง -->
						<Field.Field>
							<Field.Label for="form-capacity-kg">
								ความจุน้ำหนักแก๊สต่อถัง (กก.) [Capacity kg] <span class="font-bold text-destructive"
									>*</span
								>
							</Field.Label>
							<Input
								id="form-capacity-kg"
								name="capacity_kg"
								type="number"
								step="any"
								min="0.0001"
								bind:value={$formData.capacity_kg}
								placeholder="เช่น 15, 48, 4"
								class="h-9 w-full rounded-md border-input bg-background font-mono"
							/>
							<p class="text-xs text-muted-foreground">
								น้ำหนักแก๊สสุทธิที่บรรจุเต็มถังมาตรฐาน (กก.)
							</p>
							{#if $errors.capacity_kg}
								<Field.Error>{$errors.capacity_kg}</Field.Error>
							{/if}
						</Field.Field>

						<!-- อัตราสิ้นเปลือง -->
						<Field.Field>
							<Field.Label for="form-burn-rate">
								อัตราสิ้นเปลืองมาตรฐาน (กก./ชม.) [Burn Rate] <span
									class="font-bold text-destructive">*</span
								>
							</Field.Label>
							<Input
								id="form-burn-rate"
								name="burn_rate_kg_per_hour"
								type="number"
								step="any"
								min="0.0001"
								bind:value={$formData.burn_rate_kg_per_hour}
								placeholder="เช่น 0.50"
								class="h-9 w-full rounded-md border-input bg-background font-mono"
							/>
							<p class="text-xs text-muted-foreground">
								อัตราการเผาผลาญแก๊สของเตามาตรฐานต่อชั่วโมง
							</p>
							{#if $errors.burn_rate_kg_per_hour}
								<Field.Error>{$errors.burn_rate_kg_per_hour}</Field.Error>
							{/if}
						</Field.Field>

						<!-- ตัวคูณเวลา -->
						<Field.Field>
							<Field.Label for="form-time-multiplier">
								ตัวคูณเวลาประกอบอาหาร [Time Multiplier] <span class="font-bold text-destructive"
									>*</span
								>
							</Field.Label>
							<Input
								id="form-time-multiplier"
								name="time_multiplier"
								type="number"
								step="any"
								min="0.0001"
								bind:value={$formData.time_multiplier}
								placeholder="1.0"
								class="h-9 w-full rounded-md border-input bg-background font-mono"
							/>
							<p class="text-xs text-muted-foreground">สัดส่วนเวลามาตรฐาน (ค่าเริ่มต้นคือ 1.0)</p>
							{#if $errors.time_multiplier}
								<Field.Error>{$errors.time_multiplier}</Field.Error>
							{/if}
						</Field.Field>

						<!-- ชนิดเชื้อเพลิง & หน่วยฐาน (Locked display) -->
						<div class="flex flex-col justify-end space-y-1">
							<span class="block text-xs font-semibold text-foreground">
								ชนิดเชื้อเพลิง และหน่วยฐาน (กำหนดอัตโนมัติ)
							</span>
							<div class="grid grid-cols-2 gap-2">
								<div
									class="rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-xs"
								>
									<span class="block text-[10px] text-muted-foreground">ชนิดเชื้อเพลิง</span>
									<span class="font-semibold text-foreground">LPG (แก๊สหุงต้ม)</span>
								</div>
								<div
									class="rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-xs"
								>
									<span class="block text-[10px] text-muted-foreground">หน่วยฐาน</span>
									<span class="font-semibold text-foreground">ถัง (ล็อคอัตโนมัติ)</span>
								</div>
							</div>
						</div>
					</Field.FieldGroup>
				</div>
			{/if}

			{#if $formData.type_class === 'CONSUMABLE' || $formData.type_class === 'DURABLE'}
				<!-- Card: หน่วยทวีคูณและการตั้งค่าหน่วย -->
				<div class="space-y-5 rounded-2xl border border-border/60 bg-muted/20 p-5 sm:p-6">
					<div class="space-y-1 border-b border-border/40 pb-3">
						<h3 class="text-sm font-semibold text-foreground">
							หน่วยทวีคูณและการตั้งค่าหน่วย (Conversions & Defaults)
						</h3>
						<p class="text-xs text-muted-foreground">
							กำหนดหน่วยนับรอง (เช่น ลัง, กล่อง) และหน่วยเริ่มต้นสำหรับการจัดเก็บและเบิกจ่าย
						</p>
					</div>

					<!-- Conversion row -->
					{#if $formData.conversions && $formData.conversions.length > 0}
						<div
							class="rounded-xl border border-border/60 bg-background/80 p-3.5 text-xs shadow-xs"
						>
							<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-3">
								<Field.Field>
									<Field.Label for="form-conv-uom">ชื่อหน่วยทวีคูณ</Field.Label>
									<Input
										id="form-conv-uom"
										type="text"
										bind:value={$formData.conversions[0].uom_name}
										placeholder="เช่น กล่อง, ลัง, แผง"
										class="h-9 w-full rounded-md border-input bg-background"
									/>
								</Field.Field>

								<Field.Field>
									<Field.Label for="form-conv-mult">
										อัตราส่วน (เท่ากับกี่ {$formData.base_unit || 'หน่วยฐาน'})
									</Field.Label>
									<Input
										id="form-conv-mult"
										type="number"
										step="any"
										min={0}
										value={$formData.conversions[0].multiplier}
										oninput={(e) => {
											const val = e.currentTarget.value;
											$formData.conversions[0].multiplier = val === '' ? '1' : val;
										}}
										placeholder="1"
										class="h-9 w-full rounded-md border-input bg-background font-mono"
									/>
								</Field.Field>

								<Field.Field>
									<Field.Label for="form-conv-barcode">บาร์โค้ด (Optional)</Field.Label>
									<Input
										id="form-conv-barcode"
										type="text"
										bind:value={$formData.conversions[0].barcode}
										placeholder="สแกนหรือพิมพ์"
										class="h-9 w-full rounded-md border-input bg-background font-mono"
									/>
								</Field.Field>
							</Field.FieldGroup>
						</div>
					{/if}

					<!-- Default UOMs -->
					<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
						<Field.Field>
							<Field.Label for="form-inv-uom">หน่วยสำหรับจัดเก็บ (Inventory UOM)</Field.Label>
							<select
								id="form-inv-uom"
								name="default_inventory_uom"
								bind:value={$formData.default_inventory_uom}
								class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
							>
								<option value="">-- เลือกหน่วย --</option>
								{#each uomOptions as unit (unit)}
									<option value={unit}>{unit}</option>
								{/each}
							</select>
							{#if $errors.default_inventory_uom}
								<Field.Error>{$errors.default_inventory_uom}</Field.Error>
							{/if}
						</Field.Field>

						<Field.Field>
							<Field.Label for="form-issue-uom">หน่วยสำหรับเบิกจ่าย (Issue/Sales UOM)</Field.Label>
							<select
								id="form-issue-uom"
								name="default_issue_uom"
								bind:value={$formData.default_issue_uom}
								class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
							>
								<option value="">-- เลือกหน่วย --</option>
								{#each uomOptions as unit (unit)}
									<option value={unit}>{unit}</option>
								{/each}
							</select>
							{#if $errors.default_issue_uom}
								<Field.Error>{$errors.default_issue_uom}</Field.Error>
							{/if}
						</Field.Field>
					</Field.FieldGroup>
				</div>
			{/if}

			{#if !isFuelEnergy && ($formData.type_class === 'CONSUMABLE' || $formData.type_class === 'DURABLE')}
				<!-- Card: คุณสมบัติการจัดเก็บและจ่ายแจก -->
				<div class="space-y-5 rounded-2xl border border-border/60 bg-muted/20 p-5 sm:p-6">
					<div class="space-y-1 border-b border-border/40 pb-3">
						<h3 class="text-sm font-semibold text-foreground">
							คุณสมบัติการจัดเก็บและจ่ายแจก (Storage & Distribution)
						</h3>
						<p class="text-xs text-muted-foreground">
							กำหนดข้อจำกัดการจัดเก็บ สภาพแวดล้อม และเกณฑ์การกระจายสินค้าให้ผู้พักพิง
						</p>
					</div>

					{#if $formData.type_class === 'CONSUMABLE'}
						<!-- Row 1: อายุการเก็บ & สภาพแวดล้อม -->
						<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
							<Field.Field>
								<Field.Label for="form-shelf-life">
									อายุการเก็บรักษา (วัน) [Shelf Life Days]
								</Field.Label>
								<Input
									id="form-shelf-life"
									name="shelf_life_days"
									type="number"
									placeholder="เช่น 180"
									value={$formData.shelf_life_days ?? ''}
									oninput={(e) => {
										const val = e.currentTarget.value;
										$formData.shelf_life_days = val === '' ? undefined : Number(val);
									}}
									class="h-9 w-full rounded-md border-input bg-background font-mono"
								/>
								{#if $errors.shelf_life_days}
									<Field.Error>{$errors.shelf_life_days}</Field.Error>
								{/if}
							</Field.Field>

							<Field.Field>
								<Field.Label for="form-storage-type">ประเภทการจัดเก็บ (Storage Type)</Field.Label>
								<select
									id="form-storage-type"
									name="storage_type"
									bind:value={$formData.storage_type}
									class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
								>
									<option value="" disabled selected>-- เลือกประเภทการจัดเก็บ --</option>
									<option value="DRY">ของแห้ง (DRY)</option>
									<option value="CHILLED">แช่เย็น (CHILLED)</option>
									<option value="FROZEN">แช่แข็ง (FROZEN)</option>
									<option value="CONTROLLED_MED">ควบคุมพิเศษ/ยา (CONTROLLED_MED)</option>
								</select>
								{#if $errors.storage_type}
									<Field.Error>{$errors.storage_type}</Field.Error>
								{/if}
							</Field.Field>
						</Field.FieldGroup>

						<!-- Row 2: สารก่อภูมิแพ้ & ข้อจำกัดด้านอาหาร -->
						<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
							<Field.Field>
								<Field.Label for="form-allergens">สารก่อภูมิแพ้ (Allergens)</Field.Label>
								<Input
									id="form-allergens"
									name="allergens"
									bind:value={$formData.allergens}
									placeholder="เช่น ถั่ว, นม, แป้งสาลี"
									class="h-9 w-full rounded-md border-input bg-background"
								/>
								{#if $errors.allergens}
									<Field.Error>{$errors.allergens}</Field.Error>
								{/if}
							</Field.Field>

							<Field.Field>
								<Field.Label for="form-dietary">ข้อจำกัดด้านอาหาร (Dietary)</Field.Label>
								<select
									id="form-dietary"
									name="dietary"
									value={$formData.dietary && $formData.dietary.length > 0
										? $formData.dietary[0]
										: 'NONE'}
									onchange={(e) => {
										const val = e.currentTarget.value;
										$formData.dietary = val === 'NONE' ? [] : [val as 'HALAL' | 'VEGAN'];
									}}
									class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
								>
									<option value="NONE">ไม่มีข้อจำกัด (None)</option>
									<option value="HALAL">ฮาลาล (Halal)</option>
									<option value="VEGAN">วีแกน (Vegan)</option>
								</select>
								{#if $errors.dietary}
									<Field.Error>{$errors.dietary}</Field.Error>
								{/if}
							</Field.Field>
						</Field.FieldGroup>

						<!-- Row 3: เพศ & วัย & การแจก -->
						<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-3">
							<Field.Field>
								<Field.Label for="form-target-gender">เพศที่ใช้ได้ (Target Gender)</Field.Label>
								<select
									id="form-target-gender"
									name="target_gender"
									bind:value={$formData.target_gender}
									class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
								>
									<option value="ALL">ทุกเพศ (ALL)</option>
									<option value="MALE">ชาย (MALE)</option>
									<option value="FEMALE">หญิง (FEMALE)</option>
								</select>
								{#if $errors.target_gender}
									<Field.Error>{$errors.target_gender}</Field.Error>
								{/if}
							</Field.Field>

							<Field.Field>
								<Field.Label for="form-age-group">ช่วงวัยที่เหมาะสม (Age Group)</Field.Label>
								<select
									id="form-age-group"
									name="age_group"
									bind:value={$formData.age_group}
									class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
								>
									<option value="ALL">ทุกวัย (ALL)</option>
									<option value="INFANT">ทารก (INFANT)</option>
									<option value="CHILD">เด็ก (CHILD)</option>
									<option value="ELDERLY">ผู้สูงอายุ (ELDERLY)</option>
								</select>
								{#if $errors.age_group}
									<Field.Error>{$errors.age_group}</Field.Error>
								{/if}
							</Field.Field>

							<Field.Field>
								<Field.Label for="form-dist-type">ประเภทการแจก (Distribution Type)</Field.Label>
								<select
									id="form-dist-type"
									name="distribution_type"
									bind:value={$formData.distribution_type}
									class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
								>
									<option value="recurring">แจกซ้ำได้ตามรอบ (Recurring)</option>
									<option value="one_time">แจกครั้งเดียวต่อคน (One-Time)</option>
								</select>
								{#if $errors.distribution_type}
									<Field.Error>{$errors.distribution_type}</Field.Error>
								{/if}
							</Field.Field>
						</Field.FieldGroup>
					{:else if $formData.type_class === 'DURABLE'}
						<!-- DURABLE specific fields -->
						<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
							<Field.Field>
								<Field.Label for="form-qty-person">
									จำนวนที่ต้องมีต่อคน (Qty per Person)
								</Field.Label>
								<Input
									id="form-qty-person"
									name="qty_per_person"
									type="number"
									step="any"
									min={0}
									placeholder="เช่น 1, 0.5"
									value={$formData.qty_per_person ?? ''}
									oninput={(e) => {
										const val = e.currentTarget.value;
										$formData.qty_per_person = val === '' ? undefined : Number(val);
									}}
									class="h-9 w-full rounded-md border-input bg-background font-mono"
								/>
								{#if $errors.qty_per_person}
									<Field.Error>{$errors.qty_per_person}</Field.Error>
								{/if}
							</Field.Field>

							<div class="flex items-center space-x-3 pt-6">
								<Checkbox
									id="form-returnable"
									checked={$formData.returnable}
									onCheckedChange={(checked) => {
										$formData.returnable = !!checked;
									}}
									class="data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
								/>
								<div class="flex flex-col text-left leading-tight">
									<label
										for="form-returnable"
										class="cursor-pointer text-sm font-semibold text-foreground"
									>
										ต้องคืนเมื่อใช้งานเสร็จ (Returnable)
									</label>
									<span class="text-xs text-muted-foreground">
										รายการของใช้ที่ต้องส่งคืนเมื่อผู้พักพิงออกจากศูนย์
									</span>
								</div>
							</div>
						</Field.FieldGroup>

						<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-3">
							<Field.Field>
								<Field.Label for="form-target-gender-dur">เพศที่ใช้ได้ (Target Gender)</Field.Label>
								<select
									id="form-target-gender-dur"
									name="target_gender"
									bind:value={$formData.target_gender}
									class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
								>
									<option value="ALL">ทุกเพศ (ALL)</option>
									<option value="MALE">ชาย (MALE)</option>
									<option value="FEMALE">หญิง (FEMALE)</option>
								</select>
								{#if $errors.target_gender}
									<Field.Error>{$errors.target_gender}</Field.Error>
								{/if}
							</Field.Field>

							<Field.Field>
								<Field.Label for="form-age-group-dur">ช่วงวัยที่เหมาะสม (Age Group)</Field.Label>
								<select
									id="form-age-group-dur"
									name="age_group"
									bind:value={$formData.age_group}
									class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
								>
									<option value="ALL">ทุกวัย (ALL)</option>
									<option value="INFANT">ทารก (INFANT)</option>
									<option value="CHILD">เด็ก (CHILD)</option>
									<option value="ELDERLY">ผู้สูงอายุ (ELDERLY)</option>
								</select>
								{#if $errors.age_group}
									<Field.Error>{$errors.age_group}</Field.Error>
								{/if}
							</Field.Field>

							<Field.Field>
								<Field.Label for="form-dist-type-dur">ประเภทการแจก (Distribution Type)</Field.Label>
								<select
									id="form-dist-type-dur"
									name="distribution_type"
									bind:value={$formData.distribution_type}
									class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
								>
									<option value="recurring">แจกซ้ำได้ตามรอบ (Recurring)</option>
									<option value="one_time">แจกครั้งเดียวต่อคน (One-Time)</option>
								</select>
								{#if $errors.distribution_type}
									<Field.Error>{$errors.distribution_type}</Field.Error>
								{/if}
							</Field.Field>
						</Field.FieldGroup>
					{/if}
				</div>
			{/if}

			{#if $formData.type_class === 'EQUIPMENT'}
				<!-- Card: สถานะครุภัณฑ์ (Asset Status) -->
				<div class="space-y-5 rounded-2xl border border-border/60 bg-muted/20 p-5 sm:p-6">
					<div class="space-y-1 border-b border-border/40 pb-3">
						<h3 class="text-sm font-semibold text-foreground">สถานะครุภัณฑ์ (Asset Status)</h3>
						<p class="text-xs text-muted-foreground">กำหนดสถานะความพร้อมใช้งานของครุภัณฑ์</p>
					</div>

					<Field.Field>
						<Field.Label for="form-asset-status">สถานะปัจจุบัน</Field.Label>
						<select
							id="form-asset-status"
							name="asset_status"
							bind:value={$formData.asset_status}
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
						>
							<option value="READY">🟢 พร้อมใช้งาน (READY)</option>
							<option value="IN_USE">🔵 กำลังใช้งาน (IN_USE)</option>
							<option value="MAINTENANCE">🟡 อยู่ระหว่างการบำรุงรักษา (MAINTENANCE)</option>
							<option value="BROKEN">🔴 ชำรุดเสียหาย (BROKEN)</option>
						</select>
						{#if $errors.asset_status}
							<Field.Error>{$errors.asset_status}</Field.Error>
						{/if}
					</Field.Field>
				</div>
			{/if}

			{#if isEdit}
				<!-- Card: สถานะปิดการใช้งาน -->
				<div class="rounded-2xl border border-border/60 bg-muted/20 p-5 sm:p-6">
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<label
								for="deactivated-toggle"
								class="cursor-pointer text-sm font-semibold text-foreground"
							>
								สถานะปิดการใช้งาน (Deactivated)
							</label>
							<p class="text-xs text-muted-foreground">
								หากปิดการใช้งาน รายการนี้จะไม่แสดงให้เลือกในธุรกรรมคลังและการเบิกจ่ายใหม่
								แต่ประวัติเก่ายังคงอยู่
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
				</div>
			{/if}
		</div>

		<!-- Action Buttons -->
		<div class="flex items-center gap-3 pt-2">
			<Button
				variant="outline"
				type="button"
				onclick={() => (oncancel ?? onsuccess)?.()}
				class="rounded-xl border border-slate-200 px-6 py-6 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900/50"
			>
				ยกเลิกและย้อนกลับ
			</Button>

			<Button
				type="submit"
				disabled={$submitting || isPending}
				class="flex items-center gap-1.5 rounded-xl bg-[#002f6c] px-7 py-6 text-sm font-bold text-white shadow-md shadow-[#002f6c]/10 hover:bg-[#00204d] dark:shadow-none"
			>
				{#if $submitting || isPending}
					กำลังบันทึกข้อมูล...
				{:else if isEdit}
					บันทึกการแก้ไข
				{:else}
					บันทึกข้อมูล
				{/if}
			</Button>
		</div>
	</form>
{/if}

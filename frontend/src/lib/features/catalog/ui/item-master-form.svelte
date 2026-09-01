<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { itemMasterInputSchema, type ItemMaster, type ItemMasterInput } from '../domain/catalog';

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
	import Info from '@lucide/svelte/icons/info';

	let {
		id = '',
		isEdit = false,
		basePath = '/back-office/catalog',
		onsuccess
	}: {
		id?: string;
		isEdit?: boolean;
		basePath?: string;
		onsuccess?: () => void;
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
				shelf_life_days: undefined,
				storage_type: 'DRY',
				allergens: '',
				target_gender: 'ALL',
				age_group: 'ALL',
				dietary: [],
				qty_per_person: undefined,
				returnable: false,
				asset_status: 'READY'
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
					...validated.data,
					conversions,
					sku: validated.data.sku || undefined,
					description: validated.data.description || undefined,
					category: validated.data.category || undefined
				};

				if (validated.data.type_class === 'CONSUMABLE') {
					submitData.base_unit = validated.data.base_unit;
					submitData.conversions = validated.data.conversions;
					submitData.default_inventory_uom = validated.data.default_inventory_uom || undefined;
					submitData.default_issue_uom = validated.data.default_issue_uom || undefined;
					submitData.distribution_type = validated.data.distribution_type;
					submitData.shelf_life_days = validated.data.shelf_life_days;
					submitData.storage_type = validated.data.storage_type;
					submitData.allergens = validated.data.allergens || undefined;
					submitData.target_gender = validated.data.target_gender;
					submitData.age_group = validated.data.age_group;
					submitData.dietary = validated.data.dietary;

					delete submitData.qty_per_person;
					delete submitData.returnable;
					delete submitData.asset_status;
				} else if (validated.data.type_class === 'DURABLE') {
					submitData.base_unit = validated.data.base_unit;
					submitData.conversions = validated.data.conversions;
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
				} else if (validated.data.type_class === 'EQUIPMENT') {
					submitData.base_unit = 'ชิ้น';
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

	const { form: formData, submitting } = form;

	// Populate form fields when data loads in edit mode
	$effect(() => {
		if (isEdit && itemMasterQuery.data) {
			const item = itemMasterQuery.data;
			$formData.name = item.name || '';
			$formData.category = item.category || '';
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
			$formData.shelf_life_days = item.shelf_life_days;
			$formData.storage_type = item.storage_type || 'DRY';
			$formData.allergens = item.allergens || '';
			$formData.target_gender = item.target_gender || 'ALL';
			$formData.age_group = item.age_group || 'ALL';
			$formData.dietary = item.dietary || [];
			$formData.qty_per_person = item.qty_per_person;
			$formData.returnable = item.returnable ?? false;
			$formData.asset_status = item.asset_status || 'READY';
		}
	});

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
		<!-- Header showing category type -->
		<div class="space-y-2">
			<span class="text-sm font-semibold text-slate-800 dark:text-slate-200">
				หมวดหมู่ข้อมูล (Type)
			</span>
			<div
				class="w-full rounded-xl border border-slate-100/50 bg-slate-100/70 px-4 py-3.5 text-sm font-medium text-slate-500 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400"
			>
				รายการสิ่งของ (Item Master)
			</div>
		</div>

		<Field.FieldGroup class="space-y-6">
			<!-- ประเภทสิ่งของ (Item Class) -->
			<Form.Field
				{form}
				name="type_class"
				class="space-y-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900/30"
			>
				<Form.Control>
					{#snippet children({ props })}
						<div class="flex items-center space-x-1">
							<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
								ประเภทสิ่งของ (Item Class)
							</Form.Label>
							<span class="font-bold text-destructive">*</span>
						</div>

						<input type="hidden" {...props} bind:value={$formData.type_class} />

						<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
							<!-- CONSUMABLE -->
							<button
								type="button"
								onclick={() => ($formData.type_class = 'CONSUMABLE')}
								class="flex flex-col rounded-xl border p-5 text-left transition-all duration-200 focus:outline-none {$formData.type_class ===
								'CONSUMABLE'
									? 'border-[#002f6c] bg-[#002f6c]/5 ring-1 ring-[#002f6c] dark:border-blue-500 dark:bg-blue-950/20 dark:ring-blue-500'
									: 'border-slate-200 bg-white hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50'}"
							>
								<span class="text-sm font-bold text-slate-800 dark:text-slate-200">CONSUMABLE</span>
								<span class="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
									วัสดุสิ้นเปลือง / อาหาร (ใช้แล้วหมดไป มีอายุเก็บรักษา)
								</span>
							</button>

							<!-- DURABLE -->
							<button
								type="button"
								onclick={() => ($formData.type_class = 'DURABLE')}
								class="flex flex-col rounded-xl border p-5 text-left transition-all duration-200 focus:outline-none {$formData.type_class ===
								'DURABLE'
									? 'border-[#002f6c] bg-[#002f6c]/5 ring-1 ring-[#002f6c] dark:border-blue-500 dark:bg-blue-950/20 dark:ring-blue-500'
									: 'border-slate-200 bg-white hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50'}"
							>
								<span class="text-sm font-bold text-slate-800 dark:text-slate-200">DURABLE</span>
								<span class="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
									วัสดุคงทน (ของใช้คืนได้ เช่น เต็นท์ ผ้าห่ม)
								</span>
							</button>

							<!-- EQUIPMENT -->
							<button
								type="button"
								onclick={() => ($formData.type_class = 'EQUIPMENT')}
								class="flex flex-col rounded-xl border p-5 text-left transition-all duration-200 focus:outline-none {$formData.type_class ===
								'EQUIPMENT'
									? 'border-[#002f6c] bg-[#002f6c]/5 ring-1 ring-[#002f6c] dark:border-blue-500 dark:bg-blue-950/20 dark:ring-blue-500'
									: 'border-slate-200 bg-white hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50'}"
							>
								<span class="text-sm font-bold text-slate-800 dark:text-slate-200">EQUIPMENT</span>
								<span class="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
									ครุภัณฑ์ / อุปกรณ์ (รถยนต์ เครื่องสูบน้ำ เตาแก๊ส)
								</span>
							</button>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
			</Form.Field>

			<!-- SECTION 1: ข้อมูลสินค้า (Item Details) -->
			<section
				class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30"
			>
				<div
					class="border-slate-150 flex items-center space-x-2 border-b pb-2 dark:border-zinc-800"
				>
					<span
						class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
					>
						1
					</span>
					<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">
						ข้อมูลสินค้า (Item Details)
					</h2>
				</div>

				<Form.Field {form} name="name" class="space-y-2">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
								ชื่อสินค้า (Item Name) <span class="font-bold text-destructive">*</span>
							</Form.Label>
							<Input
								{...props}
								bind:value={$formData.name}
								placeholder="เช่น ข้าวหอมมะลิ 100%, น้ำดื่ม 600ml"
								class="h-12 rounded-xl border border-slate-200/80 px-4 text-sm placeholder:text-slate-400/80 focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
				</Form.Field>

				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<Form.Field {form} name="sku" class="space-y-2">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
									รหัสสินค้า (SKU)
								</Form.Label>
								<Input
									{...props}
									bind:value={$formData.sku}
									placeholder="เช่น P-001"
									class="h-12 rounded-xl border border-slate-200/80 px-4 text-sm placeholder:text-slate-400/80 focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
					</Form.Field>

					<Form.Field {form} name="category" class="space-y-2">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
									หมวดหมู่ (Category)
								</Form.Label>
								<select
									{...props}
									bind:value={$formData.category}
									class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
								>
									<option value="" disabled selected>-- เลือกหมวดหมู่ --</option>
									{#if itemCategoriesQuery.data}
										{#each itemCategoriesQuery.data as cat (cat._id)}
											<option value={cat.name}>{cat.name}</option>
										{/each}
									{/if}
								</select>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
					</Form.Field>
				</div>

				<Form.Field {form} name="description" class="space-y-2">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
								รายละเอียด / หมายเหตุ (Description)
							</Form.Label>
							<textarea
								{...props}
								bind:value={$formData.description}
								placeholder="เช่น ข้อมูลการจัดเก็บ, จุดเด่นของสินค้า"
								rows="3"
								class="flex w-full rounded-xl border border-slate-200/80 bg-transparent px-4 py-3 text-sm placeholder:text-slate-400/80 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
							></textarea>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
				</Form.Field>
			</section>

			{#if $formData.type_class === 'CONSUMABLE' || $formData.type_class === 'DURABLE'}
				<!-- SECTION 2: หน่วยฐาน (Base UOM) -->
				<section
					class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30"
				>
					<div
						class="border-slate-150 flex items-center space-x-2 border-b pb-2 dark:border-zinc-800"
					>
						<span
							class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
						>
							2
						</span>
						<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">
							หน่วยฐาน (Base UOM)
						</h2>
					</div>

					<!-- Warning message -->
					<div
						class="flex items-start space-x-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-amber-800 shadow-xs"
					>
						<Info class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
						<div class="text-xs leading-relaxed">
							<span class="font-bold">สำคัญ:</span> กรุณาเลือกหน่วยที่เล็กที่สุดที่จะใช้จัดเก็บในคลัง
							(เช่น เม็ด, ชิ้น, ซอง) เมื่อบันทึกแล้วจะไม่สามารถแก้ไขได้ เพื่อป้องกันความคลาดเคลื่อนของการคำนวณสต็อกย้อนหลัง
						</div>
					</div>

					<Form.Field {form} name="base_unit" class="space-y-2">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
									หน่วยที่เล็กที่สุด (Base Unit)
								</Form.Label>
								<select
									{...props}
									bind:value={$formData.base_unit}
									disabled={isEdit}
									class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-950 dark:disabled:bg-zinc-900"
								>
									<option value="" disabled selected>-- เลือกหน่วยฐาน --</option>
									{#each ['ชิ้น', 'เม็ด', 'ซอง', 'กล่อง', 'ขวด', 'กระป๋อง', 'ถุง', 'อัน', 'ชุด', 'ผืน', 'ตัว', 'คู่', 'แผ่น', 'หลอด', 'ม้วน', 'ก้อน', 'ห่อ', 'ฟอง', 'ผล', 'แกลลอน', 'ถัง', 'กรัม', 'กิโลกรัม', 'มิลลิลิตร', 'ลิตร', 'เมตร'] as unit (unit)}
										<option value={unit}>{unit}</option>
									{/each}
								</select>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
					</Form.Field>
				</section>

				<!-- SECTION 3: หน่วยทวีคูณ (Multiple UOMs / Conversions) -->
				<section
					class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30"
				>
					<div
						class="border-slate-150 flex items-center space-x-2 border-b pb-2 dark:border-zinc-800"
					>
						<span
							class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
						>
							3
						</span>
						<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">
							หน่วยทวีคูณ (Multiple UOMs / Conversions)
						</h2>
					</div>

					<div class="space-y-3">
						{#if $formData.conversions && $formData.conversions.length > 0}
							{@const conv = $formData.conversions[0]}
							<div
								class="grid grid-cols-1 items-end gap-6 rounded-2xl border border-slate-200 bg-slate-50/40 p-5 sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-950/20"
							>
								<div>
									<span class="mb-1.5 block text-xs font-bold text-slate-800 dark:text-slate-200">
										ชื่อหน่วยทวีคูณ
									</span>
									<Input
										type="text"
										bind:value={conv.uom_name}
										placeholder="เช่น กล่อง, ลัง, แผง"
										class="h-12 rounded-xl border border-slate-200/80 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950"
									/>
								</div>
								<div>
									<span class="mb-1.5 block text-xs font-bold text-slate-800 dark:text-slate-200">
										อัตราส่วน (เท่ากับกี่ หน่วยฐาน)
									</span>
									<Input
										type="number"
										step="any"
										min={0}
										value={conv.multiplier}
										oninput={(e) => {
											const val = e.currentTarget.value;
											conv.multiplier = val === '' ? '1' : val;
										}}
										placeholder="1"
										class="h-12 rounded-xl border border-slate-200/80 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950"
									/>
								</div>
								<div>
									<span class="mb-1.5 block text-xs font-bold text-slate-800 dark:text-slate-200">
										บาร์โค้ด (Optional)
									</span>
									<Input
										type="text"
										bind:value={conv.barcode}
										placeholder="สแกนหรือพิมพ์"
										class="h-12 rounded-xl border border-slate-200/80 bg-white px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950"
									/>
								</div>
							</div>
						{/if}
					</div>
				</section>

				<!-- SECTION 4: การตั้งค่าหน่วยเริ่มต้น (Default Categories / Units) -->
				<section
					class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30"
				>
					<div
						class="border-slate-150 flex items-center space-x-2 border-b pb-2 dark:border-zinc-800"
					>
						<span
							class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
						>
							4
						</span>
						<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">
							การตั้งค่าหน่วยเริ่มต้น (Default Categories)
						</h2>
					</div>

					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<Form.Field {form} name="default_inventory_uom" class="space-y-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
										หน่วยสำหรับจัดเก็บ (Inventory)
									</Form.Label>
									<select
										{...props}
										bind:value={$formData.default_inventory_uom}
										class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
									>
										<option value="">-- เลือกหน่วย --</option>
										{#each uomOptions as unit (unit)}
											<option value={unit}>{unit}</option>
										{/each}
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
						</Form.Field>

						<Form.Field {form} name="default_issue_uom" class="space-y-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
										หน่วยสำหรับเบิกจ่าย (Issue/Sales)
									</Form.Label>
									<select
										{...props}
										bind:value={$formData.default_issue_uom}
										class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
									>
										<option value="">-- เลือกหน่วย --</option>
										{#each uomOptions as unit (unit)}
											<option value={unit}>{unit}</option>
										{/each}
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
						</Form.Field>
					</div>
				</section>
			{/if}

			{#if $formData.type_class === 'CONSUMABLE' || $formData.type_class === 'DURABLE'}
				<!-- SECTION 5: คุณสมบัติการจัดเก็บและจ่ายแจก (Storage & Distribution) -->
				<section
					class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30"
				>
					<div
						class="border-slate-150 flex items-center space-x-2 border-b pb-2 dark:border-zinc-800"
					>
						<span
							class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
						>
							5
						</span>
						<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">
							คุณสมบัติการจัดเก็บและจ่ายแจก (Storage & Distribution)
						</h2>
					</div>

					{#if $formData.type_class === 'CONSUMABLE'}
						<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
							<!-- Row 1: Shelf Life, Storage Type, Allergens -->
							<Form.Field {form} name="shelf_life_days" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											อายุการเก็บรักษา (วัน) (Shelf Life Days)
										</Form.Label>
										<Input
											{...props}
											type="number"
											placeholder="เช่น 180"
											value={$formData.shelf_life_days ?? ''}
											oninput={(e) => {
												const val = e.currentTarget.value;
												$formData.shelf_life_days = val === '' ? undefined : Number(val);
											}}
											class="h-12 rounded-xl border border-slate-200/80 px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<Form.Field {form} name="storage_type" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											ประเภทการจัดเก็บ (Storage Type)
										</Form.Label>
										<select
											{...props}
											bind:value={$formData.storage_type}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="" disabled selected>-- เลือกประเภทการจัดเก็บ --</option>
											<option value="DRY">ของแห้ง (DRY)</option>
											<option value="CHILLED">แช่เย็น (CHILLED)</option>
											<option value="FROZEN">แช่แข็ง (FROZEN)</option>
											<option value="CONTROLLED_MED">ควบคุมพิเศษ/ยา (CONTROLLED_MED)</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<Form.Field {form} name="allergens" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											สารก่อภูมิแพ้ (Allergens)
										</Form.Label>
										<Input
											{...props}
											bind:value={$formData.allergens}
											placeholder="เช่น ถั่ว, นม, แป้งสาลี"
											class="h-12 rounded-xl border border-slate-200/80 px-4 text-sm placeholder:text-slate-400/80 focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<!-- Row 2: Target Gender, Age Group, Dietary -->
							<Form.Field {form} name="target_gender" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											เพศที่ใช้ได้ (Target Gender)
										</Form.Label>
										<select
											{...props}
											bind:value={$formData.target_gender}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="ALL">ทุกเพศ (ALL)</option>
											<option value="MALE">ชาย (MALE)</option>
											<option value="FEMALE">หญิง (FEMALE)</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<Form.Field {form} name="age_group" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											ช่วงวัยที่เหมาะสม (Age Group)
										</Form.Label>
										<select
											{...props}
											bind:value={$formData.age_group}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="ALL">ทุกวัย (ALL)</option>
											<option value="INFANT">ทารก (INFANT)</option>
											<option value="CHILD">เด็ก (CHILD)</option>
											<option value="ELDERLY">ผู้สูงอายุ (ELDERLY)</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<Form.Field {form} name="dietary" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											ข้อจำกัดด้านอาหาร (Dietary)
										</Form.Label>
										<select
											{...props}
											value={$formData.dietary && $formData.dietary.length > 0
												? $formData.dietary[0]
												: 'NONE'}
											onchange={(e) => {
												const val = e.currentTarget.value;
												$formData.dietary = val === 'NONE' ? [] : [val as 'HALAL' | 'VEGAN'];
											}}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="NONE">ไม่มีข้อจำกัด (None)</option>
											<option value="HALAL">ฮาลาล (Halal)</option>
											<option value="VEGAN">วีแกน (Vegan)</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<!-- Row 3: Distribution Type -->
							<Form.Field {form} name="distribution_type" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											ประเภทการแจก (Distribution Type)
										</Form.Label>
										<select
											{...props}
											bind:value={$formData.distribution_type}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="recurring">แจกซ้ำได้ตามรอบ (Recurring)</option>
											<option value="one_time">แจกครั้งเดียวต่อคน (One-Time)</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>
						</div>
					{:else if $formData.type_class === 'DURABLE'}
						<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
							<!-- Row 1: Qty per Person, Returnable -->
							<Form.Field {form} name="qty_per_person" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											จำนวนที่ต้องมีต่อคน (Qty per Person)
										</Form.Label>
										<Input
											{...props}
											type="number"
											step="any"
											min={0}
											placeholder="เช่น 1, 0.5"
											value={$formData.qty_per_person ?? ''}
											oninput={(e) => {
												const val = e.currentTarget.value;
												$formData.qty_per_person = val === '' ? undefined : Number(val);
											}}
											class="h-12 rounded-xl border border-slate-200/80 px-4 text-sm dark:border-zinc-800 dark:bg-zinc-950"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<Form.Field {form} name="returnable" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<div class="hidden h-[20px] md:block"></div>
										<div
											class="flex h-12 items-center space-x-3 rounded-xl border border-slate-200 bg-[#f8fafc]/50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/20"
										>
											<Checkbox
												{...props}
												checked={$formData.returnable}
												onCheckedChange={(checked) => {
													$formData.returnable = !!checked;
												}}
												class="data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
											/>
											<div class="flex flex-col text-left leading-tight">
												<span class="text-xs font-bold text-slate-800 dark:text-slate-200">
													ต้องคืนเมื่อใช้งานเสร็จ
												</span>
												<span class="text-[10px] text-slate-500 dark:text-zinc-400">
													(Returnable)
												</span>
											</div>
										</div>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<!-- Row 2: Target Gender, Age Group -->
							<Form.Field {form} name="target_gender" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											เพศที่ใช้ได้ (Target Gender)
										</Form.Label>
										<select
											{...props}
											bind:value={$formData.target_gender}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="ALL">ทุกเพศ (ALL)</option>
											<option value="MALE">ชาย (MALE)</option>
											<option value="FEMALE">หญิง (FEMALE)</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<Form.Field {form} name="age_group" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											ช่วงวัยที่เหมาะสม (Age Group)
										</Form.Label>
										<select
											{...props}
											bind:value={$formData.age_group}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="ALL">ทุกวัย (ALL)</option>
											<option value="INFANT">ทารก (INFANT)</option>
											<option value="CHILD">เด็ก (CHILD)</option>
											<option value="ELDERLY">ผู้สูงอายุ (ELDERLY)</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<!-- Row 3: Distribution Type -->
							<Form.Field {form} name="distribution_type" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											class="text-sm font-semibold whitespace-nowrap text-slate-800 dark:text-slate-200"
										>
											ประเภทการแจก (Distribution Type)
										</Form.Label>
										<select
											{...props}
											bind:value={$formData.distribution_type}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="recurring">แจกซ้ำได้ตามรอบ (Recurring)</option>
											<option value="one_time">แจกครั้งเดียวต่อคน (One-Time)</option>
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>
						</div>
					{/if}
				</section>
			{/if}

			{#if $formData.type_class === 'EQUIPMENT'}
				<!-- SECTION 2: สถานะครุภัณฑ์ (Asset Status) -->
				<section
					class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30"
				>
					<div
						class="border-slate-150 flex items-center space-x-2 border-b pb-2 dark:border-zinc-800"
					>
						<span
							class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
						>
							2
						</span>
						<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">
							สถานะครุภัณฑ์ (Asset Status)
						</h2>
					</div>

					<Form.Field {form} name="asset_status" class="space-y-2">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
									สถานะปัจจุบัน
								</Form.Label>
								<select
									{...props}
									bind:value={$formData.asset_status}
									class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
								>
									<option value="READY">🟢 พร้อมใช้งาน (READY)</option>
									<option value="IN_USE">🔵 กำลังใช้งาน (IN_USE)</option>
									<option value="MAINTENANCE">🟡 อยู่ระหว่างการบำรุงรักษา (MAINTENANCE)</option>
									<option value="BROKEN">🔴 ชำรุดเสียหาย (BROKEN)</option>
								</select>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
					</Form.Field>
				</section>
			{/if}

			<!-- Submit & Back Buttons -->
			<div class="flex items-center gap-3 pt-2">
				<Button
					variant="outline"
					type="button"
					onclick={onsuccess}
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
		</Field.FieldGroup>
	</form>
{/if}

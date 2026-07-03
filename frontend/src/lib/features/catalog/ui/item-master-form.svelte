<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { itemMasterInputSchema, type ItemMasterInput, type ItemMaster } from '../domain/catalog';

	import {
		useItemMaster,
		useCreateItemMaster,
		useUpdateItemMaster,
		useItemCategories
	} from '../application/queries';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SHELTER_CODE } from '$lib/features/people';
	import { toast } from 'svelte-sonner';

	// Icons
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Info from '@lucide/svelte/icons/info';

	let {
		id = '',
		isEdit = false,
		onsuccess
	}: {
		id?: string;
		isEdit?: boolean;
		onsuccess?: () => void;
	} = $props();

	// Data queries & mutations
	const itemMasterQuery = useItemMaster(() => id);
	const itemCategoriesQuery = useItemCategories();
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
				conversions: [],
				default_purchasing_uom: '',
				default_inventory_uom: '',
				default_issue_uom: '',
				distribution_type: 'consumable',
				target_reserve_days: undefined,
				consumption_rate: undefined,
				unit: '',
				timeframe: undefined,
				sphere_standard: undefined,
				overstock_alert_days: undefined,
				target_audience_type: 'all',
				target_restrictions: {
					genders: [],
					vulnerable_groups: [],
					diet_religions: []
				},
				is_default: false
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
					shelterCode: SHELTER_CODE,
					createdBy: authStore.user?.name ?? 'unknown'
				};

				// Clean up empty strings or values before saving
				const submitData = {
					...validated.data,
					sku: validated.data.sku || undefined,
					description: validated.data.description || undefined,
					category: validated.data.category || undefined,
					default_purchasing_uom: validated.data.default_purchasing_uom || undefined,
					default_inventory_uom: validated.data.default_inventory_uom || undefined,
					default_issue_uom: validated.data.default_issue_uom || undefined,
					unit: validated.data.unit || undefined,
					target_restrictions: {
						genders: validated.data.target_restrictions?.genders || [],
						vulnerable_groups: validated.data.target_restrictions?.vulnerable_groups || [],
						diet_religions: validated.data.target_restrictions?.diet_religions || []
					}
				};

				if (isEdit) {
					if (!itemMasterQuery.data) {
						toast.error('ไม่พบข้อมูลมาสเตอร์ต้นทาง');
						return;
					}
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
				} else {
					createMutation.mutate(
						{ input: submitData, ctx },
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

	const { form: formData, submitting, reset } = form;

	// Populate form fields when data loads in edit mode
	$effect(() => {
		if (isEdit && itemMasterQuery.data) {
			const item = itemMasterQuery.data;
			$formData.name = item.name || '';
			$formData.category = item.category || '';
			$formData.sku = item.sku || '';
			$formData.description = item.description || '';
			$formData.base_unit = item.base_unit || '';
			$formData.conversions = item.conversions ? JSON.parse(JSON.stringify(item.conversions)) : [];
			$formData.default_purchasing_uom = item.default_purchasing_uom || '';
			$formData.default_inventory_uom = item.default_inventory_uom || '';
			$formData.default_issue_uom = item.default_issue_uom || '';
			$formData.distribution_type = item.distribution_type || 'consumable';
			$formData.target_reserve_days = item.target_reserve_days;
			$formData.consumption_rate = item.consumption_rate;
			$formData.unit = item.unit || '';
			$formData.timeframe =
				item.timeframe === 'daily' || item.timeframe === 'weekly' ? item.timeframe : undefined;
			$formData.sphere_standard = item.sphere_standard;
			$formData.overstock_alert_days = item.overstock_alert_days;
			$formData.target_audience_type = item.target_audience_type || 'all';
			$formData.target_restrictions = {
				genders: item.target_restrictions?.genders || [],
				vulnerable_groups: item.target_restrictions?.vulnerable_groups || [],
				diet_religions: item.target_restrictions?.diet_religions || []
			};
			$formData.is_default = item.is_default || false;
		}
	});

	const isLoading = $derived(isEdit ? itemMasterQuery.isLoading : false);
	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);

	// Dynamically compute list of UOM choices for defaults in Section 4 and planning unit in Section 5
	const uomOptions = $derived(
		[$formData.base_unit, ...$formData.conversions.map((c) => c.uom_name)].filter(Boolean)
	);

	// Conversion Helper Actions
	function addConversion() {
		$formData.conversions = [
			...$formData.conversions,
			{ uom_name: '', multiplier: 1, barcode: '' }
		];
	}

	// Remove conversion
	function removeConversion(index: number) {
		$formData.conversions = $formData.conversions.filter((_, i) => i !== index);
	}

	// Restriction toggles helpers
	function toggleGender(gender: 'male' | 'female' | 'other') {
		if (!$formData.target_restrictions.genders) {
			$formData.target_restrictions.genders = [];
		}
		const list = $formData.target_restrictions.genders;
		if (list.includes(gender)) {
			$formData.target_restrictions.genders = list.filter((g) => g !== gender);
		} else {
			$formData.target_restrictions.genders = [...list, gender];
		}
	}

	// Toggle vulnerable
	function toggleVulnerable(group: 'elderly' | 'pregnant' | 'bedridden' | 'infant' | 'isolated') {
		if (!$formData.target_restrictions.vulnerable_groups) {
			$formData.target_restrictions.vulnerable_groups = [];
		}
		const list = $formData.target_restrictions.vulnerable_groups;
		if (list.includes(group)) {
			$formData.target_restrictions.vulnerable_groups = list.filter((v) => v !== group);
		} else {
			$formData.target_restrictions.vulnerable_groups = [...list, group];
		}
	}

	// Toggle diet/religion
	function toggleDietReligion(diet: 'halal' | 'vegetarian' | 'vegan') {
		if (!$formData.target_restrictions.diet_religions) {
			$formData.target_restrictions.diet_religions = [];
		}
		const list = $formData.target_restrictions.diet_religions;
		if (list.includes(diet)) {
			$formData.target_restrictions.diet_religions = list.filter((d) => d !== diet);
		} else {
			$formData.target_restrictions.diet_religions = [...list, diet];
		}
	}
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
			<!-- SECTION 1: ข้อมูลสินค้า (Item Details) -->
			<section class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30">
				<div class="flex items-center space-x-2 border-b border-slate-150 pb-2 dark:border-zinc-800">
					<span
						class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
					>
						1
					</span>
					<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">ข้อมูลสินค้า (Item Details)</h2>
				</div>

				<Form.Field {form} name="name" class="space-y-2">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
								ชื่อสินค้า (Item Name) <span class="text-destructive font-bold">*</span>
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
										{#each itemCategoriesQuery.data as cat}
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

			<!-- SECTION 2: หน่วยฐาน (Base UOM) -->
			<section class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30">
				<div class="flex items-center space-x-2 border-b border-slate-150 pb-2 dark:border-zinc-800">
					<span
						class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
					>
						2
					</span>
					<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">หน่วยฐาน (Base UOM)</h2>
				</div>

				<!-- Warning message -->
				<div
					class="flex items-start space-x-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-amber-800 shadow-xs"
				>
					<Info class="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
					<div class="text-xs leading-relaxed">
						<span class="font-bold">สำคัญ:</span> กรุณาเลือกหน่วยที่เล็กที่สุดที่จะใช้จัดเก็บในคลัง (เช่น
						เม็ด, ชิ้น, ซอง) เมื่อบันทึกแล้วจะไม่สามารถแก้ไขได้ เพื่อป้องกันความคลาดเคลื่อนของการคำนวณสต็อกย้อนหลัง
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
								{#each ['ชิ้น', 'เม็ด', 'ซอง', 'กล่อง', 'ขวด', 'กระป๋อง', 'ถุง', 'กรัม', 'กิโลกรัม', 'มิลลิลิตร', 'ลิตร'] as unit}
									<option value={unit}>{unit}</option>
								{/each}
							</select>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
				</Form.Field>
			</section>

			<!-- SECTION 3: หน่วยทวีคูณ (Multiple UOMs / Conversions) -->
			<section class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30">
				<div class="flex items-center space-x-2 border-b border-slate-150 pb-2 dark:border-zinc-800">
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
					{#each $formData.conversions as conv, index}
						<div
							class="relative grid grid-cols-1 items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-3"
						>
							<div>
								<span class="mb-1.5 block text-xs font-bold text-slate-800 dark:text-slate-200">
									ชื่อหน่วยทวีคูณ
								</span>
								<Input
									type="text"
									bind:value={conv.uom_name}
									placeholder="เช่น กล่อง, ลัง, แพ็ค"
									class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950 px-4 text-sm"
								/>
							</div>
							<div>
								<span class="mb-1.5 block text-xs font-bold text-slate-800 dark:text-slate-200">
									อัตราส่วน (เท่ากับกี่หน่วยฐาน)
								</span>
								<Input
									type="number"
									min={1}
									value={conv.multiplier}
									oninput={(e) => {
										const val = e.currentTarget.value;
										conv.multiplier = val === '' ? 1 : Number(val);
									}}
									placeholder="เช่น 12"
									class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950 px-4 text-sm"
								/>
							</div>
							<div class="flex items-center gap-2">
								<div class="flex-1">
									<span class="mb-1.5 block text-xs font-bold text-slate-800 dark:text-slate-200">
										บาร์โค้ด (Optional)
									</span>
									<Input
										type="text"
										bind:value={conv.barcode}
										placeholder="สแกนหรือพิมพ์"
										class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950 px-4 text-sm"
									/>
								</div>
								<Button
									type="button"
									variant="ghost"
									class="mt-6 shrink-0 h-12 w-12 rounded-xl border border-slate-200 text-destructive hover:bg-destructive/10 dark:border-zinc-800"
									onclick={() => removeConversion(index)}
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{/each}

					<Button
						type="button"
						variant="outline"
						class="mt-2 flex h-12 items-center gap-1.5 rounded-xl border border-slate-200/80 px-5 font-bold text-[#002f6c] hover:bg-slate-50 dark:border-zinc-800 dark:text-blue-400 dark:hover:bg-zinc-900/50"
						onclick={addConversion}
					>
						<Plus class="h-4 w-4" />
						เพิ่มหน่วยทวีคูณ
					</Button>
				</div>
			</section>

			<!-- SECTION 4: การตั้งค่าหน่วยเริ่มต้น (Default Categories / Units) -->
			<section class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30">
				<div class="flex items-center space-x-2 border-b border-slate-150 pb-2 dark:border-zinc-800">
					<span
						class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
					>
						4
					</span>
					<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">
						การตั้งค่าหน่วยเริ่มต้น (Default Categories)
					</h2>
				</div>

				<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
					<Form.Field {form} name="default_purchasing_uom" class="space-y-2">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
									หน่วยสำหรับสั่งซื้อ (Purchasing)
								</Form.Label>
								<select
									{...props}
									bind:value={$formData.default_purchasing_uom}
									class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
								>
									<option value="">-- เลือกหน่วย --</option>
									{#each uomOptions as unit}
										<option value={unit}>{unit}</option>
									{/each}
								</select>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
					</Form.Field>

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
									{#each uomOptions as unit}
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
									{#each uomOptions as unit}
										<option value={unit}>{unit}</option>
									{/each}
								</select>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
					</Form.Field>
				</div>
			</section>

			<!-- SECTION 5: พารามิเตอร์การวางแผน (Planning Parameters) -->
			<section class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30">
				<div class="flex items-center space-x-2 border-b border-slate-150 pb-2 dark:border-zinc-800">
					<span
						class="flex h-6 w-6 items-center justify-center rounded-full bg-[#002f6c]/10 text-xs font-bold text-[#002f6c] dark:bg-blue-900/30 dark:text-blue-400"
					>
						5
					</span>
					<h2 class="text-base font-bold text-slate-800 dark:text-slate-200">
						พารามิเตอร์การวางแผน (Planning Parameters)
					</h2>
				</div>

				{#if $formData.distribution_type === 'one_time'}
					<!-- สำหรับของแจกรายบุคคล (ONE_TIME) -->
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Form.Field {form} name="distribution_type" class="space-y-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">
										ประเภทการแจกจ่าย (Distribution Type)
									</Form.Label>
									<select
										{...props}
										bind:value={$formData.distribution_type}
										class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
									>
										<option value="consumable">วัสดุสิ้นเปลือง (CONSUMABLE)</option>
										<option value="one_time">ของแจกรายบุคคล (ONE_TIME)</option>
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
						</Form.Field>

						<div class="flex items-end gap-2">
							<Form.Field {form} name="consumption_rate" class="flex-1 space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">
											สิทธิ์ต่อหัว (Quota per person)
										</Form.Label>
										<Input
											{...props}
											type="number"
											value={$formData.consumption_rate ?? ''}
											oninput={(e) => {
												const val = e.currentTarget.value;
												$formData.consumption_rate = val === '' ? undefined : Number(val);
											}}
											class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950 px-4 text-sm"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>
							<span class="text-sm font-bold text-slate-500 pb-3 shrink-0 dark:text-zinc-400">
								{$formData.base_unit || 'ชุด'}/คน
							</span>
						</div>
					</div>
				{:else}
					<!-- สำหรับวัสดุสิ้นเปลือง (CONSUMABLE) -->
					<!-- First row of planning params -->
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Form.Field {form} name="distribution_type" class="space-y-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">
										ประเภทการแจกจ่าย (Distribution Type)
									</Form.Label>
									<select
										{...props}
										bind:value={$formData.distribution_type}
										class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
									>
										<option value="consumable">วัสดุสิ้นเปลือง (CONSUMABLE)</option>
										<option value="one_time">ของแจกรายบุคคล (ONE_TIME)</option>
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
						</Form.Field>

						<Form.Field {form} name="target_reserve_days" class="space-y-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">
										เป้าหมายการสำรองสูงสุด (Target Reserve Days)
									</Form.Label>
									<Input
										{...props}
										type="number"
										placeholder="เช่น 30"
										value={$formData.target_reserve_days ?? ''}
										oninput={(e) => {
											const val = e.currentTarget.value;
											$formData.target_reserve_days = val === '' ? undefined : Number(val);
										}}
										class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950 px-4 text-sm"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
						</Form.Field>

						<div class="grid grid-cols-2 gap-2">
							<Form.Field {form} name="consumption_rate" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">
											อัตราการบริโภค (Rate)
										</Form.Label>
										<Input
											{...props}
											type="number"
											step="any"
											placeholder="เช่น 0.4"
											value={$formData.consumption_rate ?? ''}
											oninput={(e) => {
												const val = e.currentTarget.value;
												$formData.consumption_rate = val === '' ? undefined : Number(val);
											}}
											class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950 px-4 text-sm"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>

							<Form.Field {form} name="unit" class="space-y-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">หน่วย</Form.Label>
										<select
											{...props}
											bind:value={$formData.unit}
											class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
										>
											<option value="">-- เลือกหน่วย --</option>
											{#each uomOptions as unit}
												<option value={unit}>{unit}</option>
											{/each}
										</select>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
							</Form.Field>
						</div>
					</div>

					<!-- Second row of planning params -->
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
						<Form.Field {form} name="timeframe" class="space-y-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">
										กรอบเวลา (Timeframe)
									</Form.Label>
									<select
										{...props}
										bind:value={$formData.timeframe}
										class="h-12 w-full rounded-xl border border-slate-200/80 bg-background px-3 text-sm focus:ring-2 focus:ring-ring focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
									>
										<option value={undefined}>-- เลือกกรอบเวลา --</option>
										<option value="daily">ต่อวัน (daily)</option>
										<option value="weekly">ต่อสัปดาห์ (weekly)</option>
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
						</Form.Field>

						<Form.Field {form} name="sphere_standard" class="space-y-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">
										ตัวคูณมาตรฐานดำรงชีพ (Sphere Standard / คน)
									</Form.Label>
									<Input
										{...props}
										type="number"
										step="any"
										placeholder="เช่น 1, 2.5"
										value={$formData.sphere_standard ?? ''}
										oninput={(e) => {
											const val = e.currentTarget.value;
											$formData.sphere_standard = val === '' ? undefined : Number(val);
										}}
										class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950 px-4 text-sm"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
						</Form.Field>

						<Form.Field {form} name="overstock_alert_days" class="space-y-2">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-end pb-1.5">
										แจ้งเตือนสินค้าล้นสต็อก (Overstock Alert / วัน)
									</Form.Label>
									<Input
										{...props}
										type="number"
										placeholder="14"
										value={$formData.overstock_alert_days ?? ''}
										oninput={(e) => {
											const val = e.currentTarget.value;
											$formData.overstock_alert_days = val === '' ? undefined : Number(val);
										}}
										class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950 px-4 text-sm"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
						</Form.Field>
					</div>
				{/if}

				<!-- Target Audience -->
				<div class="space-y-3 pt-3">
					<span class="block text-sm font-semibold text-slate-800 dark:text-slate-200">
						เป้าหมายการแจกจ่าย (Target Audience)
					</span>

					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<!-- Card 1: All -->
						<button
							type="button"
							class="flex items-start space-x-3 rounded-xl border p-4 text-left transition duration-200 {$formData.target_audience_type ===
							'all'
								? 'border-[#002f6c] bg-[#002f6c]/5 ring-2 ring-[#002f6c] dark:border-blue-400 dark:bg-blue-950/20 dark:ring-blue-400'
								: 'border-slate-200/80 bg-white hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50'}"
							onclick={() => ($formData.target_audience_type = 'all')}
						>
							<div
								class="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary"
							>
								{#if $formData.target_audience_type === 'all'}
									<div class="h-2.5 w-2.5 rounded-full bg-[#002f6c] dark:bg-blue-400"></div>
								{/if}
							</div>
							<div>
								<span class="text-sm font-bold text-[#002f6c] dark:text-blue-400">แจกทุกคน (All / No Restriction)</span>
								<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
									ระบบจะนำจำนวนคนทั้งศูนย์มาคำนวณอัตราความต้องการ (Default)
								</p>
							</div>
						</button>

						<!-- Card 2: Specific Segments -->
						<button
							type="button"
							class="flex items-start space-x-3 rounded-xl border p-4 text-left transition duration-200 {$formData.target_audience_type ===
							'specific_segments'
								? 'border-[#002f6c] bg-[#002f6c]/5 ring-2 ring-[#002f6c] dark:border-blue-400 dark:bg-blue-950/20 dark:ring-blue-400'
								: 'border-slate-200/80 bg-white hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50'}"
							onclick={() => ($formData.target_audience_type = 'specific_segments')}
						>
							<div
								class="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary"
							>
								{#if $formData.target_audience_type === 'specific_segments'}
									<div class="h-2.5 w-2.5 rounded-full bg-[#002f6c] dark:bg-blue-400"></div>
								{/if}
							</div>
							<div>
								<span class="text-sm font-bold text-[#002f6c] dark:text-blue-400"
									>จำกัดเฉพาะกลุ่ม (Specific Segments)</span
								>
								<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
									เลือกเงื่อนไข เพศ, กลุ่มเปราะบาง หรือศาสนา
								</p>
							</div>
						</button>
					</div>

					<!-- Restrictions Panel -->
					{#if $formData.target_audience_type === 'specific_segments'}
						<div
							class="mt-4 space-y-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-950"
						>
							<!-- Genders -->
							<div>
								<div class="mb-2.5 flex items-center space-x-2">
									<div class="h-3 w-1 rounded-full bg-blue-500"></div>
									<h3 class="text-xs font-bold tracking-wider text-slate-500 uppercase">
										เพศ (GENDER)
									</h3>
								</div>
								<div class="flex flex-wrap gap-3">
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.genders?.includes('male')}
											onchange={() => toggleGender('male')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">ชาย (Male)</span>
									</label>
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.genders?.includes('female')}
											onchange={() => toggleGender('female')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">หญิง (Female)</span>
									</label>
								</div>
							</div>

							<!-- Vulnerable Groups -->
							<div>
								<div class="mb-2.5 flex items-center space-x-2">
									<div class="h-3 w-1 rounded-full bg-amber-500"></div>
									<h3 class="text-xs font-bold tracking-wider text-slate-500 uppercase">
										กลุ่มเปราะบาง (VULNERABLE)
									</h3>
								</div>
								<div class="flex flex-wrap gap-2.5">
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.vulnerable_groups?.includes('elderly')}
											onchange={() => toggleVulnerable('elderly')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">👵 ผู้สูงอายุ</span>
									</label>
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.vulnerable_groups?.includes(
												'pregnant'
											)}
											onchange={() => toggleVulnerable('pregnant')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">🤰 หญิงตั้งครรภ์</span>
									</label>
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.vulnerable_groups?.includes(
												'bedridden'
											)}
											onchange={() => toggleVulnerable('bedridden')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">🛌 ผู้ป่วยติดเตียง</span>
									</label>
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.vulnerable_groups?.includes('infant')}
											onchange={() => toggleVulnerable('infant')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">👶 เด็กอ่อน (0-3 ปี)</span>
									</label>
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.vulnerable_groups?.includes(
												'isolated'
											)}
											onchange={() => toggleVulnerable('isolated')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">🏥 ผู้ป่วย/แยกกักโรค</span>
									</label>
								</div>
							</div>

							<!-- Diet & Religion -->
							<div>
								<div class="mb-2.5 flex items-center space-x-2">
									<div class="h-3 w-1 rounded-full bg-emerald-500"></div>
									<h3 class="text-xs font-bold tracking-wider text-slate-500 uppercase">
										ศาสนา / อาหาร (DIET & RELIGION)
									</h3>
								</div>
								<div class="flex flex-wrap gap-2.5">
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.diet_religions?.includes('halal')}
											onchange={() => toggleDietReligion('halal')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">อิสลาม (ฮาลาล)</span>
									</label>
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.diet_religions?.includes('vegetarian')}
											onchange={() => toggleDietReligion('vegetarian')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">มังสวิรัติ (Vegetarian)</span>
									</label>
									<label
										class="flex cursor-pointer items-center space-x-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-xs hover:bg-slate-50"
									>
										<input
											type="checkbox"
											checked={$formData.target_restrictions.diet_religions?.includes('vegan')}
											onchange={() => toggleDietReligion('vegan')}
											class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
										/>
										<span class="text-slate-700 dark:text-zinc-300">วีแกน (Vegan)</span>
									</label>
								</div>
							</div>
						</div>
					{/if}
				</div>
			</section>

			<!-- Default switch -->
			<div
				class="flex items-start gap-4 rounded-xl border border-blue-50/50 bg-[#f4f8fc] p-5 dark:border-zinc-800/60 dark:bg-zinc-900/30"
			>
				<Checkbox
					id="is_default"
					bind:checked={$formData.is_default}
					class="mt-0.5 h-5 w-5 rounded border-slate-300 data-[state=checked]:border-[#002f6c] data-[state=checked]:bg-[#002f6c]"
				/>
				<div class="grid gap-1.5 leading-none">
					<label
						for="is_default"
						class="cursor-pointer text-[13px] font-bold text-slate-800 dark:text-slate-200"
					>
						ตั้งค่าเป็นค่าเริ่มต้นสำหรับประเภทนี้ (Set as Default Option)
					</label>
					<p class="text-[11px] leading-relaxed font-medium text-slate-400 dark:text-slate-400/85">
						เมื่อเลือก ตัวเลือกนี้จะถูกตั้งเป็นตัวเลือกเริ่มต้นอัตโนมัติในการลงทะเบียนหรือเรียกใช้งานของหัวข้อนี้
					</p>
				</div>
			</div>

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

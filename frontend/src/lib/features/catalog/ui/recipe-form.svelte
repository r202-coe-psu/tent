<!-- src/lib/features/catalog/ui/recipe-form.svelte -->
<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { recipeInputSchema, type Recipe } from '../domain/catalog';
	import {
		useRecipe,
		useCreateRecipe,
		useUpdateRecipe,
		useItemMasters,
		useUnitsOfMeasure
	} from '../application/queries';
	import { formatUnit } from '../domain/unit-of-measure';
	import { langState } from '$lib/states/i18n.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Check from '@lucide/svelte/icons/check';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import ItemSelector from './recipe/item-selector.svelte';

	let {
		id = '',
		isEdit = false,
		basePath = '/back-office/catalog',
		compact = false,
		onsuccess
	}: {
		id?: string;
		isEdit?: boolean;
		basePath?: string;
		compact?: boolean;
		onsuccess?: () => void;
	} = $props();

	const shelterCode = $derived(
		basePath.includes('system-management') ? undefined : getShelterCode()
	);

	const itemRecipeQuery = useRecipe(
		() => id,
		() => shelterCode ?? null
	);
	const createMutation = useCreateRecipe();
	const updateMutation = useUpdateRecipe();
	const itemMastersQuery = useItemMasters(() => shelterCode ?? null);
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);

	const form = superForm(
		defaults(zod4(recipeInputSchema), {
			defaults: {
				label: '',
				ingredients: [{ item_master_id: '', quantity: '1', uom: '' }],
				standard_portions: '100',
				standard_duration_hours: '1',
				deactivated: false
			}
		}),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4(recipeInputSchema),
			resetForm: false,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) return;

				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};

				const submitData = {
					...validated.data
				};
				if (isEdit) {
					if (!itemRecipeQuery.data) {
						toast.error('ไม่พบข้อมูลมาสเตอร์ต้นทาง');
						return;
					}
					if (basePath.includes('back-office') && !itemRecipeQuery.data.shelter_code) {
						const { _rev, ...recipeData } = itemRecipeQuery.data;
						void _rev;
						const overrideDoc = {
							...recipeData,
							...submitData,
							shelter_code: shelterCode,
							override: true
						};
						updateMutation.mutate(overrideDoc, {
							onSuccess: () => {
								toast.success(`ปรับแต่งสูตรอาหาร ${validated.data.label} สำหรับศูนย์นี้สำเร็จ`);
								onsuccess?.();
							},
							onError: (err: Error) => toast.error(err.message)
						});
					} else {
						const updatedDoc: Recipe = {
							...itemRecipeQuery.data,
							...submitData
						};
						updateMutation.mutate(updatedDoc, {
							onSuccess: () => {
								toast.success(`ปรับปรุงข้อมูล ${validated.data.label} สำเร็จ`);
								onsuccess?.();
							},
							onError: (err: Error) => toast.error(err.message)
						});
					}
				} else {
					createMutation.mutate(
						{ input: submitData, ctx, shelterCode },
						{
							onSuccess: () => {
								toast.success(`เพิ่มข้อมูล ${validated.data.label} สำเร็จ`);
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

	let populatedId = $state<string | null>(null);

	$effect(() => {
		if (isEdit && itemRecipeQuery.data && populatedId !== itemRecipeQuery.data._id) {
			populatedId = itemRecipeQuery.data._id;
			const item = itemRecipeQuery.data;
			$formData.label = item.label || '';
			$formData.ingredients = item.ingredients ? JSON.parse(JSON.stringify(item.ingredients)) : [];
			$formData.standard_portions = item.standard_portions;
			$formData.standard_duration_hours = item.standard_duration_hours;
			$formData.deactivated = item.deactivated ?? false;
		}
	});

	const isLoading = $derived(isEdit ? itemRecipeQuery.isLoading : false);
	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);

	// const ingredientsOption = $derived(
	// 	[$formData.ingredients]
	// )

	function addIngredient() {
		$formData.ingredients = [
			...$formData.ingredients,
			{ item_master_id: '', quantity: '1', uom: '' }
		];
	}

	function removeIngredient(index: number) {
		$formData.ingredients = $formData.ingredients.filter((_, i) => i !== index);
	}

	function sanitizeQuantity(val: string): string {
		let cleaned = val.replace(/[^0-9.]/g, '');
		const parts = cleaned.split('.');
		if (parts.length > 2) {
			cleaned = parts[0] + '.' + parts.slice(1).join('');
		}
		if (/^0\d/.test(cleaned)) {
			cleaned = cleaned.replace(/^0+/, '');
			if (cleaned === '') cleaned = '0';
		}
		return cleaned;
	}

	function sanitizeInteger(val: string): string {
		let cleaned = val.replace(/[^0-9]/g, '');
		if (/^0\d/.test(cleaned)) {
			cleaned = cleaned.replace(/^0+/, '');
		}
		return cleaned;
	}
</script>

{#if isLoading}
	<div class="py-12 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลสินค้า...</div>
{:else}
	<form
		method="POST"
		use:form.enhance
		class={compact ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'space-y-6'}
	>
		<div class={compact ? 'min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4 sm:p-6' : 'space-y-3.5'}>
			<div class="space-y-1.5">
				<span class="text-sm font-semibold text-slate-800 dark:text-slate-200"> ประเภทข้อมูล </span>
				<div
					class="w-full rounded-xl border border-slate-100/50 bg-slate-100/70 px-4 py-2.5 text-sm font-medium text-slate-500 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400"
				>
					สูตรอาหาร
				</div>
			</div>

			<Field.FieldGroup class="gap-0 space-y-3.5">
				<!-- SECTION 1: ข้อมูลสินค้า (Item Details) -->
				<Form.Field {form} name="label">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
								ชื่อสูตรอาหาร <span class="font-bold text-red-500">*</span>
							</Form.Label>
							<Input
								{...props}
								bind:value={$formData.label}
								placeholder="เช่น ข้าวหอมมะลิ 100%, น้ำดื่ม 600ml"
								class="h-10 w-full rounded-xl border border-slate-200/80 px-3.5 text-sm placeholder:text-slate-400/80 focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<!-- SECTION 2: รายการส่วนประกอบ (Ingredients / JSON) -->
				<section
					class="space-y-3.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/30"
				>
					<div class="flex items-center justify-between">
						<div class="space-y-1">
							<h3 class="text-sm font-bold text-slate-800 dark:text-slate-200">
								รายการส่วนประกอบ (Ingredients / JSON)
							</h3>
							<Form.Field {form} name="ingredients">
								<Form.Control>
									{#snippet children({ props })}
										<input type="hidden" {...props} />
									{/snippet}
								</Form.Control>
								<Form.FieldErrors class="text-xs font-semibold text-destructive" />
							</Form.Field>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={addIngredient}
							class="min-h-9 gap-1.5 rounded-xl border-slate-200 bg-white font-bold text-[#0A2647] hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-blue-400"
						>
							<Plus class="h-3.5 w-3.5" />
							เพิ่มวัตถุดิบ
						</Button>
					</div>

					<div class="space-y-3">
						{#each $formData.ingredients as conv, index (index)}
							{@const unitLocalized = conv.uom
								? formatUnit(conv.uom, units, langState.current)
								: ''}
							{@const showUnitLocalized = !!unitLocalized && unitLocalized !== conv.uom}
							<div
								class="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-2xs sm:flex-row sm:items-start dark:border-zinc-800 dark:bg-zinc-950"
							>
								<!-- ค้นหาวัตถุดิบจากคลัง -->
								<div class="min-w-0 flex-1 space-y-1.5">
									<span class="text-xs font-bold text-blue-700 dark:text-blue-400"
										>ค้นหาวัตถุดิบจากคลัง</span
									>
									<ItemSelector
										bind:value={conv.item_master_id}
										bind:uom={conv.uom}
										items={(itemMastersQuery.data ?? []).filter(
											(im) => !im.deactivated || im._id === conv.item_master_id
										)}
									/>
								</div>

								<!-- กลุ่ม: ปริมาณ + หน่วย + ปุ่มลบ (บนจอแคบจะอยู่แถวเดียวกัน ไม่ตกบรรทัดคนละแถว) -->
								<div class="flex items-start gap-2.5 sm:shrink-0">
									<!-- ปริมาณ -->
									<div class="min-w-0 flex-1 space-y-1.5 sm:w-28 sm:flex-none">
										<span class="text-xs font-bold text-blue-700 dark:text-blue-400">ปริมาณ</span>
										<Input
											type="text"
											inputmode="decimal"
											placeholder="1"
											value={conv.quantity}
											oninput={(e) => {
												conv.quantity = sanitizeQuantity(e.currentTarget.value);
											}}
											onblur={() => {
												if (
													!conv.quantity ||
													conv.quantity.trim() === '' ||
													Number(conv.quantity) <= 0
												) {
													conv.quantity = '1';
												}
											}}
											class="h-12 rounded-xl border-slate-200/80 bg-white text-center font-medium focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
										/>
									</div>

									<!-- หน่วย -->
									<div class="min-w-0 flex-1 space-y-1.5 sm:w-28 sm:flex-none">
										<div class="flex items-center justify-between gap-1 overflow-hidden">
											<span class="text-xs font-bold text-blue-700 dark:text-blue-400">หน่วย</span>
											{#if showUnitLocalized}
												<span
													class="truncate text-2xs font-medium text-slate-500 dark:text-slate-400"
													title={unitLocalized}
												>
													({unitLocalized})
												</span>
											{/if}
										</div>
										<Input
											type="text"
											bind:value={conv.uom}
											placeholder="kg"
											class="h-12 rounded-xl border-slate-200/80 bg-white text-center font-semibold focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
										/>
									</div>

									<!-- Action Buttons (ปุ่มลบ) -->
									{#if $formData.ingredients.length > 1}
										<div class="pt-5.5 sm:pt-5.5">
											<Button
												type="button"
												variant="ghost"
												class="h-12 w-12 shrink-0 rounded-xl border border-slate-100 text-destructive hover:bg-destructive/10 dark:border-zinc-800"
												onclick={() => removeIngredient(index)}
												title={`ลบวัตถุดิบแถวที่ ${index + 1}`}
											>
												<Trash2 class="h-5 w-5" />
												<span class="sr-only">ลบวัตถุดิบแถวที่ {index + 1}</span>
											</Button>
										</div>
									{/if}
								</div>
							</div>
						{/each}

						<Button
							type="button"
							variant="outline"
							onclick={addIngredient}
							class="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 bg-white text-sm font-bold text-[#0A2647] hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-blue-400 dark:hover:bg-zinc-900"
						>
							<Plus class="h-4 w-4" />
							เพิ่มวัตถุดิบ
						</Button>
					</div>

					<div class="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
						<Form.Field {form} name="standard_portions" class="space-y-1.5">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-xs font-bold text-slate-800 dark:text-slate-200">
										ยอดกำลังผลิตมาตรฐาน (Portions)
									</Form.Label>
									<Input
										{...props}
										type="text"
										inputmode="numeric"
										placeholder="เช่น 100"
										value={$formData.standard_portions ?? ''}
										oninput={(e) => {
											$formData.standard_portions = sanitizeInteger(e.currentTarget.value);
										}}
										onblur={() => {
											if (
												!$formData.standard_portions ||
												$formData.standard_portions.trim() === ''
											) {
												$formData.standard_portions = '100';
											}
										}}
										class="h-10 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="text-xs font-semibold text-destructive" />
						</Form.Field>

						<Form.Field {form} name="standard_duration_hours" class="space-y-1.5">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-xs font-bold text-slate-800 dark:text-slate-200">
										ระยะเวลาการผลิตมาตรฐาน (ชั่วโมง)
									</Form.Label>
									<Input
										{...props}
										type="text"
										inputmode="decimal"
										placeholder="เช่น 1"
										value={$formData.standard_duration_hours ?? ''}
										oninput={(e) => {
											$formData.standard_duration_hours = sanitizeQuantity(e.currentTarget.value);
										}}
										onblur={() => {
											if (
												!$formData.standard_duration_hours ||
												$formData.standard_duration_hours.trim() === ''
											) {
												$formData.standard_duration_hours = '1';
											}
										}}
										class="h-10 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="text-xs font-semibold text-destructive" />
						</Form.Field>
					</div>
				</section>

				{#if isEdit}
					<!-- SECTION: สถานะการใช้งาน (Status) -->
					<section
						class="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/30"
					>
						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<label
									for="recipe-deactivated-toggle"
									class="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-200"
								>
									สถานะปิดการใช้งาน
								</label>
								<p class="text-xs text-muted-foreground">
									หากปิดการใช้งาน สูตรอาหารนี้จะไม่แสดงให้เลือกในแผนเตรียมอาหารใหม่
									แต่ประวัติเก่ายังคงอยู่
								</p>
							</div>
							<Checkbox
								id="recipe-deactivated-toggle"
								checked={$formData.deactivated}
								onCheckedChange={(val) => {
									$formData.deactivated = !!val;
								}}
							/>
						</div>
					</section>
				{/if}
			</Field.FieldGroup>
		</div>

		<div
			class={compact
				? 'shrink-0 border-t border-slate-200/80 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950'
				: 'sticky bottom-0 -mx-4 mt-8 -mb-4 border-t border-slate-200/80 bg-white/95 px-6 py-4 shadow-xs backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95'}
		>
			<div
				class="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-end sm:gap-3"
			>
				<Button
					variant="outline"
					type="button"
					onclick={onsuccess}
					class="min-h-11 rounded-xl border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto dark:border-zinc-700 dark:text-zinc-300"
				>
					ยกเลิกและย้อนกลับ
				</Button>

				<Button
					type="submit"
					disabled={$submitting || isPending}
					class="min-h-11 gap-2 rounded-xl bg-[#0A2647] px-6 text-sm font-semibold text-white shadow-xs hover:bg-[#051930] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
				>
					{#if $submitting || isPending}
						<Loader2 class="h-4 w-4 animate-spin" />
						กำลังบันทึกข้อมูล...
					{:else}
						<Check class="h-4 w-4" />
						{isEdit ? 'บันทึกการแก้ไข' : 'บันทึกสูตรอาหาร'}
					{/if}
				</Button>
			</div>
		</div>
	</form>
{/if}

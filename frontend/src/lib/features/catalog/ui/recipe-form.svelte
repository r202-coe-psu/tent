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
	import { sanitizeInteger, sanitizeQuantity } from '../domain/recipe-input';
	import { qtyInputStep } from '../domain/unit-quantity';
	import { useUnitDimensionResolver } from '../application/use-unit-dimension-resolver.svelte';
	import { recipeIngredientQtyIssues } from './recipe-ingredient-qty';
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
	const dimensions = useUnitDimensionResolver();

	const wholeQtySchema = recipeInputSchema.superRefine((data, ctx) => {
		for (const { index, message } of recipeIngredientQtyIssues(
			data.ingredients,
			dimensions.resolve
		)) {
			ctx.addIssue({ code: 'custom', message, path: ['ingredients', index, 'quantity'] });
		}
	});

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
			validators: zod4(wholeQtySchema),
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

	// Same look as the stock item form (item-master-form.svelte).
	const sectionClass = $derived(
		compact
			? 'space-y-4 rounded-xl border border-border/80 bg-muted/30 p-4'
			: 'space-y-5 rounded-2xl border border-border/80 bg-muted/30 p-6'
	);

	const qtyMessages = $derived(
		new Map(
			recipeIngredientQtyIssues($formData.ingredients, dimensions.resolve).map((i) => [
				i.index,
				i.message
			])
		)
	);

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
				<span class="text-sm font-semibold"> ประเภทข้อมูล </span>
				<div
					class="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm font-medium text-muted-foreground"
				>
					สูตรอาหาร
				</div>
			</div>

			<Field.FieldGroup class="gap-0 space-y-3.5">
				<!-- SECTION 1: ข้อมูลสินค้า (Item Details) -->
				<Form.Field {form} name="label">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold">
								ชื่อสูตรอาหาร <span class="text-destructive">*</span>
							</Form.Label>
							<Input
								{...props}
								bind:value={$formData.label}
								placeholder="เช่น ข้าวหอมมะลิ 100%, น้ำดื่ม 600ml"
								class="h-11 sm:h-10"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<!-- SECTION 2: รายการส่วนประกอบ (Ingredients / JSON) -->
				<section class={sectionClass}>
					<div class="flex items-center justify-between">
						<div class="space-y-1">
							<h2 class="text-sm font-bold text-foreground">
								รายการส่วนประกอบ (Ingredients / JSON)
							</h2>
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
							class="h-8 gap-1"
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
								class="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-start"
							>
								<!-- ค้นหาวัตถุดิบจากคลัง -->
								<div class="min-w-0 flex-1 space-y-1.5">
									<span class="text-xs font-semibold text-muted-foreground"
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
										<span class="text-xs font-semibold text-muted-foreground">ปริมาณ</span>
										<Input
											type="number"
											step={qtyInputStep(dimensions.resolve(conv.uom))}
											min={0}
											placeholder="1"
											bind:value={
												() => (conv.quantity === '' ? null : Number(conv.quantity)),
												(v) => (conv.quantity = v == null ? '' : String(v))
											}
											aria-invalid={qtyMessages.has(index)}
											onblur={() => {
												if (conv.quantity === '') conv.quantity = '1';
											}}
											class="h-11 text-center font-medium sm:h-10"
										/>
										{#if qtyMessages.has(index)}
											<p class="text-xs font-semibold text-destructive">{qtyMessages.get(index)}</p>
										{/if}
									</div>

									<!-- หน่วย -->
									<div class="min-w-0 flex-1 space-y-1.5 sm:w-28 sm:flex-none">
										<div class="flex items-center justify-between gap-1 overflow-hidden">
											<span class="text-xs font-semibold text-muted-foreground">หน่วย</span>
											{#if showUnitLocalized}
												<span
													class="truncate text-2xs font-medium text-muted-foreground"
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
											class="h-11 text-center font-semibold sm:h-10"
										/>
									</div>

									<!-- Action Buttons (ปุ่มลบ) -->
									{#if $formData.ingredients.length > 1}
										<div class="pt-5.5 sm:pt-5.5">
											<Button
												type="button"
												variant="ghost"
												class="h-11 w-11 shrink-0 text-destructive hover:bg-destructive/10 sm:h-10 sm:w-10"
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
							class="h-10 w-full gap-1.5 border-dashed"
						>
							<Plus class="h-4 w-4" />
							เพิ่มวัตถุดิบ
						</Button>
					</div>

					<div class="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
						<Form.Field {form} name="standard_portions" class="space-y-1.5">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold">
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
										class="h-11 sm:h-10"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="text-xs font-semibold text-destructive" />
						</Form.Field>

						<Form.Field {form} name="standard_duration_hours" class="space-y-1.5">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-sm font-semibold">
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
										class="h-11 sm:h-10"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors class="text-xs font-semibold text-destructive" />
						</Form.Field>
					</div>
				</section>

				{#if isEdit}
					<!-- SECTION: สถานะการใช้งาน (Status) -->
					<section class={sectionClass}>
						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<label for="recipe-deactivated-toggle" class="cursor-pointer text-sm font-semibold">
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
				? 'shrink-0 border-t border-border bg-background px-6 py-4'
				: 'sticky bottom-0 -mx-4 mt-8 -mb-4 border-t border-border bg-background/95 px-6 py-4 backdrop-blur-sm'}
		>
			<div
				class="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-end sm:gap-3"
			>
				<Button variant="outline" type="button" onclick={onsuccess} class="rounded-xl sm:w-auto">
					ยกเลิกและย้อนกลับ
				</Button>

				<Button
					type="submit"
					disabled={$submitting || isPending || qtyMessages.size > 0}
					class="gap-2 sm:w-auto"
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

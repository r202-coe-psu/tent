<!-- src/lib/features/catalog/ui/recipe-form.svelte -->
<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { recipeInputSchema, type Recipe } from '../domain/catalog';
	import {
		useRecipe,
		useCreateRecipe,
		useUpdateRecipe,
		useItemMasters
	} from '../application/queries';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import {
		persistedQuantityFromPerPotion,
		quantityPerPotionFromPersisted,
		totalQuantityForPotions
	} from '../domain/recipe-quantity';
	import { qtyGt } from '$lib/utils/qty';
	import CatalogFormSection from './catalog-form-section.svelte';

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

	const itemRecipeQuery = useRecipe(
		() => id,
		() => shelterCode ?? null
	);
	const createMutation = useCreateRecipe();
	const updateMutation = useUpdateRecipe();
	const itemMastersQuery = useItemMasters(() => shelterCode ?? null);

	const form = superForm(
		defaults(zod4(recipeInputSchema), {
			defaults: {
				label: '',
				ingredients: [],
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
					...validated.data,
					ingredients: validated.data.ingredients.map((ingredient) => ({
						...ingredient,
						quantity: persistedQuantityFromPerPotion(
							ingredient.quantity,
							validated.data.standard_portions
						),
						uom:
							itemMastersQuery.data?.find((item) => item._id === ingredient.item_master_id)
								?.base_unit ?? ingredient.uom
					}))
				};
				if (isEdit) {
					if (!itemRecipeQuery.data) {
						toast.error('ไม่พบข้อมูลมาสเตอร์ต้นทาง');
						return;
					}
					if (basePath.includes('back-office') && !itemRecipeQuery.data.shelter_code) {
						// eslint-disable-next-line @typescript-eslint/no-unused-vars
						const { _rev, ...recipeData } = itemRecipeQuery.data;
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
	const { form: formData, errors, submitting } = form;

	let populatedId = $state<string | null>(null);

	$effect(() => {
		if (isEdit && itemRecipeQuery.data && populatedId !== itemRecipeQuery.data._id) {
			populatedId = itemRecipeQuery.data._id;
			const item = itemRecipeQuery.data;
			$formData.label = item.label || '';
			$formData.ingredients = (item.ingredients ?? []).map((ingredient) => ({
				...ingredient,
				quantity: quantityPerPotionFromPersisted(ingredient.quantity, item.standard_portions)
			}));
			$formData.standard_portions = item.standard_portions;
			$formData.standard_duration_hours = item.standard_duration_hours;
			$formData.deactivated = item.deactivated ?? false;
		}
	});

	const isLoading = $derived(isEdit ? itemRecipeQuery.isLoading : false);
	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);
	const standardPortionsAreValid = $derived(isPositiveQuantity($formData.standard_portions));
	const ingredientTotals = $derived.by(() => {
		const totals: Record<string, string> = {};
		for (const ingredient of $formData.ingredients) {
			if (standardPortionsAreValid && isPositiveQuantity(ingredient.quantity)) {
				totals[ingredient.item_master_id] = totalQuantityForPotions(
					ingredient.quantity,
					$formData.standard_portions
				);
			}
		}
		return totals;
	});

	const availableItemMasters = $derived(
		(itemMastersQuery.data ?? []).filter(
			(item) =>
				!item.deactivated &&
				!$formData.ingredients.some((ingredient) => ingredient.item_master_id === item._id)
		)
	);

	const itemOptions = $derived(
		availableItemMasters.map((im) => ({
			value: im._id,
			label: im.name,
			sku: im.sku,
			base_unit: im.base_unit || '',
			keywords: [im.name, im.sku ?? '', im._id, im.base_unit ?? ''].filter(Boolean)
		}))
	);

	let newIngredient = $state({ item_master_id: '', quantity: '1', uom: '' });
	const newIngredientQuantityIsValid = $derived(isPositiveQuantity(newIngredient.quantity));
	const canAddIngredient = $derived(
		Boolean(newIngredient.item_master_id) && newIngredientQuantityIsValid
	);

	function isPositiveQuantity(value: string | number | undefined): boolean {
		if (value === undefined || value === '') return false;
		try {
			return qtyGt(value, 0);
		} catch {
			return false;
		}
	}

	function addIngredient() {
		const targetId = newIngredient.item_master_id;
		if (!targetId) return;

		if ($formData.ingredients.some((ingredient) => ingredient.item_master_id === targetId)) {
			toast.error('วัตถุดิบนี้อยู่ในสูตรแล้ว');
			return;
		}

		const item = itemMastersQuery.data?.find((candidate) => candidate._id === targetId);

		if (!isPositiveQuantity(newIngredient.quantity)) {
			toast.error('กรุณาระบุจำนวนที่ถูกต้อง');
			return;
		}

		$formData.ingredients = [
			...$formData.ingredients,
			{
				item_master_id: targetId,
				quantity: newIngredient.quantity,
				uom: item?.base_unit ?? newIngredient.uom ?? 'ชิ้น'
			}
		];
		toast.success(`เพิ่ม "${item?.name ?? 'วัตถุดิบ'}" ลงในสูตรแล้ว`);
		newIngredient = { item_master_id: '', quantity: '1', uom: '' };
	}

	// Selecting an ingredient only stages it (fills the row + previews its unit) — it does NOT
	// add it to the recipe. The user still has to review/adjust quantity and press "เพิ่ม".
	function handleItemSelect(selectedId: string) {
		if (!selectedId) {
			newIngredient.uom = '';
			return;
		}
		const item = itemMastersQuery.data?.find((candidate) => candidate._id === selectedId);
		newIngredient.uom = item?.base_unit ?? '';
	}

	function removeIngredient(itemMasterId: string) {
		$formData.ingredients = $formData.ingredients.filter(
			(ingredient) => ingredient.item_master_id !== itemMasterId
		);
	}

	function itemName(itemMasterId: string): string {
		return itemMastersQuery.data?.find((item) => item._id === itemMasterId)?.name ?? itemMasterId;
	}

	function itemUnit(itemMasterId: string, persistedUnit: string): string {
		return (
			itemMastersQuery.data?.find((item) => item._id === itemMasterId)?.base_unit ?? persistedUnit
		);
	}
</script>

{#if isLoading}
	<div class="py-12 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลสินค้า...</div>
{:else}
	<form method="POST" use:form.enhance class="space-y-6">
		<div class="space-y-5">
			<!-- Card 1: ข้อมูลสูตรอาหาร (Recipe Details) -->
			<CatalogFormSection
				number={1}
				title="ข้อมูลสูตรอาหาร (Recipe Details)"
				description="กำหนดชื่อสูตรอาหารสำหรับแสดงในระบบและแผนเตรียมอาหาร"
			>
				<Field.Field>
					<Field.Label for="form-label">
						ชื่อสูตรอาหาร (Recipe Name) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-label"
						name="label"
						bind:value={$formData.label}
						placeholder="เช่น ข้าวสวย, ต้มจืดเต้าหู้หมูสับ, แกงเขียวหวานไก่"
						class="h-9 w-full rounded-md border-input bg-background text-sm"
					/>
					{#if $errors.label}
						<Field.Error>{$errors.label}</Field.Error>
					{/if}
				</Field.Field>
			</CatalogFormSection>

			<!-- Card 2: รายการส่วนประกอบ (Ingredients / BOM) -->
			<CatalogFormSection
				number={2}
				title="รายการส่วนประกอบ (Ingredients / BOM)"
				description="กำหนดวัตถุดิบและปริมาณต่อ 1 potion ระบบจะคำนวณยอดรวมมาตรฐานตามกำลังผลิต ({$formData.standard_portions ||
					'0'} potion) ให้อัตโนมัติ"
			>
				{#if $errors.ingredients}
					<Field.Error>{$errors.ingredients}</Field.Error>
				{/if}

				<div class="overflow-x-auto rounded-xl border border-border/60 bg-background">
					<Table.Root class="min-w-[720px]">
						<Table.Header class="bg-muted/40">
							<Table.Row class="hover:bg-transparent">
								<Table.Head class="py-2.5 pl-4 text-xs font-semibold text-muted-foreground">
									ส่วนผสม
								</Table.Head>
								<Table.Head
									class="w-36 py-2.5 text-right text-xs font-semibold text-muted-foreground"
								>
									ต่อ 1 potion
								</Table.Head>
								<Table.Head
									class="w-48 py-2.5 text-right text-xs font-semibold text-muted-foreground"
								>
									รวม ({$formData.standard_portions || '0'} potion)
								</Table.Head>
								<Table.Head
									class="w-24 py-2.5 text-center text-xs font-semibold text-muted-foreground"
								>
									หน่วย
								</Table.Head>
								<Table.Head
									class="w-16 py-2.5 pr-4 text-center text-xs font-semibold text-muted-foreground"
								>
									จัดการ
								</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each $formData.ingredients as ingredient (ingredient.item_master_id)}
								<Table.Row class="hover:bg-muted/30">
									<Table.Cell class="py-2 pl-4 text-xs font-medium text-foreground">
										{itemName(ingredient.item_master_id)}
									</Table.Cell>
									<Table.Cell class="py-2">
										<label class="sr-only" for={`ingredient-quantity-${ingredient.item_master_id}`}>
											ปริมาณต่อ 1 potion สำหรับ {itemName(ingredient.item_master_id)}
										</label>
										<Input
											id={`ingredient-quantity-${ingredient.item_master_id}`}
											type="number"
											step="any"
											min="0.0001"
											value={ingredient.quantity}
											oninput={(event) => (ingredient.quantity = event.currentTarget.value)}
											class="h-8 w-full rounded-md border-input bg-background text-right text-xs tabular-nums focus-visible:ring-1 focus-visible:ring-ring"
										/>
									</Table.Cell>
									<Table.Cell
										class="py-2 text-right text-xs font-medium text-foreground tabular-nums"
									>
										{ingredientTotals[ingredient.item_master_id] ?? '—'}
									</Table.Cell>
									<Table.Cell class="py-2 text-center text-xs text-muted-foreground">
										{itemUnit(ingredient.item_master_id, ingredient.uom)}
									</Table.Cell>
									<Table.Cell class="py-2 pr-4 text-center">
										<Button
											type="button"
											variant="ghost"
											size="icon"
											class="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
											onclick={() => removeIngredient(ingredient.item_master_id)}
										>
											<Trash2 class="h-4 w-4" />
											<span class="sr-only">ลบวัตถุดิบ {itemName(ingredient.item_master_id)}</span>
										</Button>
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={5} class="py-8 text-center text-xs text-muted-foreground">
										ยังไม่มีวัตถุดิบในสูตรอาหาร กรุณาค้นหาและเพิ่มจากแถวด้านล่าง
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer class="border-t border-border/60 bg-muted/20">
							<Table.Row class="hover:bg-transparent">
								<Table.Cell class="py-2.5 pl-4">
									<Combobox
										items={itemOptions}
										bind:value={newIngredient.item_master_id}
										onValueChange={handleItemSelect}
										placeholder="-- เลือกหรือค้นหาวัตถุดิบ --"
										searchPlaceholder="ค้นหาชื่อวัตถุดิบ หรือ SKU..."
										emptyText="ไม่พบรายการวัตถุดิบ"
										disabled={itemMastersQuery.isLoading}
										class="h-8 w-full justify-between rounded-md border-input bg-background px-3 text-xs font-normal shadow-xs"
									>
										{#snippet children({ item })}
											<div class="flex w-full items-center justify-between gap-2">
												<div class="flex min-w-0 flex-col text-left">
													<span class="truncate text-xs font-semibold text-foreground"
														>{item.label}</span
													>
													{#if item.sku}
														<span class="truncate text-2xs text-muted-foreground">
															{item.sku}
														</span>
													{/if}
												</div>
												{#if item.base_unit}
													<span
														class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-semibold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
													>
														{item.base_unit}
													</span>
												{/if}
											</div>
										{/snippet}
									</Combobox>
								</Table.Cell>
								<Table.Cell class="py-2.5">
									<label class="sr-only" for="new-ingredient-quantity">ปริมาณต่อ 1 potion</label>
									<Input
										id="new-ingredient-quantity"
										type="number"
										step="any"
										min="0.0001"
										value={newIngredient.quantity}
										oninput={(event) => (newIngredient.quantity = event.currentTarget.value)}
										class="h-8 w-full rounded-md border-input bg-background text-right text-xs tabular-nums focus-visible:ring-1 focus-visible:ring-ring"
									/>
								</Table.Cell>
								<Table.Cell class="py-2.5 text-right text-xs text-muted-foreground tabular-nums">
									{standardPortionsAreValid && newIngredientQuantityIsValid
										? totalQuantityForPotions(newIngredient.quantity, $formData.standard_portions)
										: '—'}
								</Table.Cell>
								<Table.Cell class="py-2.5 text-center text-xs text-muted-foreground">
									{newIngredient.uom || '—'}
								</Table.Cell>
								<Table.Cell class="py-2.5 pr-4 text-center">
									<Button
										type="button"
										size="sm"
										disabled={!canAddIngredient}
										class="h-8 gap-1 rounded-md bg-[#002f6c] px-3 text-xs font-semibold text-white hover:bg-[#00204d]"
										onclick={() => addIngredient()}
									>
										<Plus class="h-3.5 w-3.5" />
										<span>เพิ่ม</span>
									</Button>
								</Table.Cell>
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>

				<!-- ยอดกำลังผลิตมาตรฐาน (Potion) และระยะเวลาการผลิต อยู่ด้านล่างตารางรายการส่วนประกอบ -->
				<div class="border-t border-border/40 pt-4">
					<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
						<Field.Field class="space-y-1.5">
							<Field.Label for="form-portions">
								ยอดกำลังผลิตมาตรฐาน (Potion) <span class="font-bold text-destructive">*</span>
							</Field.Label>
							<Input
								id="form-portions"
								name="standard_portions"
								type="number"
								step="any"
								placeholder="เช่น 100"
								value={$formData.standard_portions ?? ''}
								oninput={(e) => {
									const val = e.currentTarget.value;
									$formData.standard_portions = val;
								}}
								class="h-9 w-full rounded-md border-input bg-background text-sm"
							/>
							<p class="text-xs text-muted-foreground">
								จำนวน potion มาตรฐานสำหรับคำนวณสัดส่วนวัตถุดิบรวมในสูตร (ค่าเริ่มต้นคือ 100)
							</p>
							{#if $errors.standard_portions}
								<Field.Error>{$errors.standard_portions}</Field.Error>
							{/if}
						</Field.Field>

						<Field.Field class="space-y-1.5">
							<Field.Label for="form-duration">
								ระยะเวลาการผลิตมาตรฐาน (ชั่วโมง) <span class="font-bold text-destructive">*</span>
							</Field.Label>
							<Input
								id="form-duration"
								name="standard_duration_hours"
								type="number"
								step="any"
								placeholder="เช่น 1"
								value={$formData.standard_duration_hours ?? ''}
								oninput={(e) => {
									const val = e.currentTarget.value;
									$formData.standard_duration_hours = val === '' ? '0' : val;
								}}
								class="h-9 w-full rounded-md border-input bg-background text-sm"
							/>
							<p class="text-xs text-muted-foreground">
								ระยะเวลาเฉลี่ยที่ใช้ในการปรุงอาหารตามสูตรนี้
							</p>
							{#if $errors.standard_duration_hours}
								<Field.Error>{$errors.standard_duration_hours}</Field.Error>
							{/if}
						</Field.Field>
					</Field.FieldGroup>
				</div>
			</CatalogFormSection>

			{#if isEdit}
				<!-- Card 3: สถานะการใช้งาน (Status) -->
				<CatalogFormSection number={3} title="สถานะปิดการใช้งาน (Deactivated)">
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<label
								for="recipe-deactivated-toggle"
								class="cursor-pointer text-sm font-semibold text-foreground"
							>
								สถานะปิดการใช้งาน (Deactivated)
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
							class="data-[state=checked]:border-[var(--brand-primary)] data-[state=checked]:bg-[var(--brand-primary)]"
						/>
					</div>
				</CatalogFormSection>
			{/if}

			<!-- Action Buttons -->
			<div class="flex items-center gap-3 pt-2">
				<Button
					variant="outline"
					type="button"
					onclick={() => (oncancel ?? onsuccess)?.()}
					class="h-11 rounded-xl border border-slate-200 px-6 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900/50"
				>
					ยกเลิกและย้อนกลับ
				</Button>

				<Button
					type="submit"
					disabled={$submitting || isPending || !standardPortionsAreValid}
					class="flex h-11 items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] px-7 text-sm font-bold text-white shadow-2xs hover:bg-[var(--brand-primary-hover)] dark:shadow-none"
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
		</div>
	</form>
{/if}

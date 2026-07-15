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
		useItemMasters
	} from '../application/queries';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ItemSelector from './recipe/item-selector.svelte';

	let {
		id = '',
		isEdit = false,
		onsuccess
	}: {
		id?: string;
		isEdit?: boolean;
		onsuccess?: () => void;
	} = $props();

	const itemRecipeQuery = useRecipe(() => id);
	const createMutation = useCreateRecipe();
	const updateMutation = useUpdateRecipe();
	const itemMastersQuery = useItemMasters();

	const form = superForm(
		defaults(zod4(recipeInputSchema), {
			defaults: {
				label: '',
				ingredients: [{ item_master_id: '', quantity: '1', uom: '' }],
				standard_portions: '100',
				standard_duration_hours: '1',
				is_default: false
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
				} else {
					createMutation.mutate(
						{ input: submitData, ctx },
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

	$effect(() => {
		if (isEdit && itemRecipeQuery.data) {
			const item = itemRecipeQuery.data;
			$formData.label = item.label || '';
			$formData.ingredients = item.ingredients ? JSON.parse(JSON.stringify(item.ingredients)) : [];
			$formData.standard_portions = item.standard_portions;
			$formData.standard_duration_hours = item.standard_duration_hours;
			$formData.is_default = item.is_default || false;
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
	<form method="POST" use:form.enhance class="space-y-6">
		<div class="space-y-2">
			<span class="text-sm font-semibold text-slate-800 dark:text-slate-200">
				หมวดหมู่ข้อมูล (Type)
			</span>
			<div
				class="w-full rounded-xl border border-slate-100/50 bg-slate-100/70 px-4 py-3.5 text-sm font-medium text-slate-500 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400"
			>
				สูตรอาหารมาตรฐาน (Recipe)
			</div>
		</div>

		<Field.FieldGroup class="space-y-6">
			<!-- SECTION 1: ข้อมูลสินค้า (Item Details) -->
			<Form.Field {form} name="label">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
							Label (ชื่อแสดงผลภาษาไทย) <span class="font-bold text-red-500">*</span>
						</Form.Label>
						<Input
							{...props}
							bind:value={$formData.label}
							placeholder="เช่น ข้าวหอมมะลิ 100%, น้ำดื่ม 600ml"
							class="w-full rounded-xl border border-slate-200/80 px-4 py-6 text-sm placeholder:text-slate-400/80 focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
			<!-- SECTION 2: รายการส่วนประกอบ (Ingredients / JSON) -->
			<section
				class="space-y-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-6 dark:border-zinc-800 dark:bg-zinc-900/30"
			>
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

				<div class="space-y-3">
					{#each $formData.ingredients as conv, index (index)}
						<div
							class="flex flex-col items-stretch gap-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm md:flex-row md:items-end dark:border-zinc-800 dark:bg-zinc-950"
						>
							<!-- ค้นหาวัตถุดิบจากคลัง -->
							<div class="flex-1 space-y-1.5">
								<span class="text-xs font-bold text-blue-700 dark:text-blue-400"
									>ค้นหาวัตถุดิบจากคลัง</span
								>
								<ItemSelector
									bind:value={conv.item_master_id}
									bind:uom={conv.uom}
									items={itemMastersQuery.data ?? []}
								/>
							</div>

							<!-- ปริมาณ -->
							<div class="w-full space-y-1.5 md:w-28">
								<span class="text-xs font-bold text-blue-700 dark:text-blue-400">ปริมาณ</span>
								<Input
									type="number"
									step="any"
									min={0}
									value={conv.quantity}
									oninput={(e) => {
										const val = e.currentTarget.value;
										conv.quantity = val === '' ? '1' : val;
									}}
									class="h-12 rounded-xl border-slate-200/80 bg-white text-center dark:border-zinc-800 dark:bg-zinc-950"
								/>
							</div>

							<!-- หน่วย -->
							<div class="w-full space-y-1.5 md:w-28">
								<span class="text-xs font-bold text-blue-700 dark:text-blue-400">หน่วย</span>
								<Input
									type="text"
									bind:value={conv.uom}
									placeholder="kg"
									class="h-12 rounded-xl border-slate-200/80 bg-white text-center font-semibold dark:border-zinc-800 dark:bg-zinc-950"
								/>
							</div>

							<!-- Action Buttons -->
							<div class="mt-4 flex items-center gap-2 md:mt-0">
								{#if $formData.ingredients.length > 1}
									<Button
										type="button"
										variant="ghost"
										class="h-12 w-12 shrink-0 rounded-xl border border-slate-100 text-destructive hover:bg-destructive/10 dark:border-zinc-800"
										onclick={() => removeIngredient(index)}
									>
										<Trash2 class="h-5 w-5" />
									</Button>
								{/if}
								{#if index === $formData.ingredients.length - 1}
									<Button
										type="button"
										onclick={addIngredient}
										class="flex h-12 shrink-0 items-center gap-1 rounded-xl bg-slate-100 px-5 font-bold text-[#002f6c] hover:bg-slate-200 dark:bg-zinc-800 dark:text-blue-400 dark:hover:bg-zinc-700"
									>
										<Plus class="h-4 w-4" />
										เพิ่ม
									</Button>
								{/if}
							</div>
						</div>
					{/each}
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
									type="number"
									placeholder="เช่น 100"
									value={$formData.standard_portions ?? ''}
									oninput={(e) => {
										const val = e.currentTarget.value;
										$formData.standard_portions = val === '' ? '0' : val;
									}}
									class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950"
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
									type="number"
									step="any"
									placeholder="เช่น 1"
									value={$formData.standard_duration_hours ?? ''}
									oninput={(e) => {
										const val = e.currentTarget.value;
										$formData.standard_duration_hours = val === '' ? '0' : val;
									}}
									class="h-12 rounded-xl border border-slate-200/80 dark:border-zinc-800 dark:bg-zinc-950"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="text-xs font-semibold text-destructive" />
					</Form.Field>
				</div>
			</section>

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
						เมื่อเลือก
						ตัวเลือกนี้จะถูกตั้งเป็นตัวเลือกเริ่มต้นอัตโนมัติในการลงทะเบียนหรือเรียกใช้งานของหัวข้อนี้
					</p>
				</div>
			</div>

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
						+ เพิ่ม
					{/if}
				</Button>
			</div>
		</Field.FieldGroup>
	</form>
{/if}

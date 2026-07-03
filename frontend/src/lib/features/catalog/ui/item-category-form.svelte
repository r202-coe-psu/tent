<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { itemCategoryInputSchema, type ItemCategoryInput } from '../domain/catalog';
	import {
		useItemCategory,
		useCreateItemCategory,
		useUpdateItemCategory
	} from '../application/queries';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SHELTER_CODE } from '$lib/features/people';
	import { toast } from 'svelte-sonner';

	let {
		id = '',
		isEdit = false,
		onsuccess
	}: {
		id?: string;
		isEdit?: boolean;
		onsuccess?: () => void;
	} = $props();

	// 1. Data queries and mutations
	const categoryQuery = useItemCategory(() => id);
	const createMutation = useCreateItemCategory();
	const updateMutation = useUpdateItemCategory();

	const form = superForm(defaults(zod4(itemCategoryInputSchema)), {
		SPA: true,
		validators: zod4(itemCategoryInputSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) return;

			const ctx = {
				shelterCode: SHELTER_CODE,
				createdBy: authStore.user?.name ?? 'unknown'
			};

			if (isEdit) {
				if (!categoryQuery.data) {
					toast.error('ไม่พบข้อมูลหมวดหมู่ต้นทาง');
					return;
				}
				const updatedDoc = {
					...categoryQuery.data,
					name: validated.data.name,
					is_default: validated.data.is_default
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
					{ input: validated.data, ctx },
					{
						onSuccess: () => {
							toast.success(`เพิ่มหมวดหมู่ ${validated.data.name} สำเร็จ`);
							reset();
							onsuccess?.();
						},
						onError: (err: Error) => toast.error(err.message)
					}
				);
			}
		}
	});

	const { form: formData, submitting, reset } = form;

	// 2. Populate form fields when data loads in edit mode
	$effect(() => {
		if (isEdit && categoryQuery.data) {
			$formData.name = categoryQuery.data.name;
			$formData.is_default = categoryQuery.data.is_default;
		}
	});

	const isLoading = $derived(isEdit ? categoryQuery.isLoading : false);
	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);
	// isError
</script>

{#if isLoading}
	<div class="py-12 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลหมวดหมู่...</div>
{:else}
	<form method="POST" use:form.enhance class="space-y-6">
		<div class="space-y-5">
			<div class="space-y-2">
				<span class="text-sm font-semibold text-slate-800 dark:text-slate-200">
					หมวดหมู่ข้อมูล (Type)
				</span>
				<div
					class="w-full rounded-xl border border-slate-100/50 bg-slate-100/70 px-4 py-3.5 text-sm font-medium text-slate-500 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400"
				>
					หมวดหมู่สิ่งของ (Item Category)
				</div>
			</div>

			<!-- Field 2: Label (ชื่อแสดงผลภาษาไทย) -->
			<Form.Field {form} name="name" class="space-y-2">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="text-sm font-semibold text-slate-800 dark:text-slate-200">
							Label (ชื่อแสดงผลภาษาไทย) <span class="font-bold text-red-500">*</span>
						</Form.Label>
						<Input
							{...props}
							bind:value={$formData.name}
							placeholder="เช่น ข้าวสวยมาตรฐานกุมารแพทย์, ไข่เป็ดต้มสุก"
							class="w-full rounded-xl border border-slate-200/80 px-4 py-6 text-sm placeholder:text-slate-400/80 focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800 dark:bg-zinc-950"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
			</Form.Field>

			<!-- Field 3: ตั้งค่าเป็นค่าเริ่มต้นสำหรับประเภทนี้ (Set as Default Option) -->
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
	</form>
{/if}

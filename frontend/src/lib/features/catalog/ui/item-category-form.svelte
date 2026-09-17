<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { itemCategoryInputSchema, type TypeClass } from '../domain/catalog';
	import {
		useItemCategory,
		useCreateItemCategory,
		useUpdateItemCategory
	} from '../application/queries';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { toast } from 'svelte-sonner';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
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

	// 1. Data queries and mutations
	const categoryQuery = useItemCategory(
		() => id,
		() => shelterCode ?? null
	);
	const createMutation = useCreateItemCategory();
	const updateMutation = useUpdateItemCategory();

	const isProtected = $derived(isEdit && !!categoryQuery.data?.is_protected);

	const CLASS_OPTIONS: Array<{
		value: TypeClass;
		label: string;
		desc: string;
	}> = [
		{
			value: 'CONSUMABLE',
			label: 'พัสดุสิ้นเปลือง (CONSUMABLE)',
			desc: 'สิ่งของอุปโภคบริโภคที่ใช้แล้วหมดไป เช่น อาหาร น้ำดื่ม ยา เวชภัณฑ์ สบู่'
		},
		{
			value: 'DURABLE',
			label: 'พัสดุคงทน (DURABLE)',
			desc: 'สิ่งของใช้งานหมุนเวียน ยืม-คืน ไม่สูญสลายในครั้งเดียว เช่น เสื่อ มุ้ง ผ้าห่ม เต็นท์'
		},
		{
			value: 'EQUIPMENT',
			label: 'ครุภัณฑ์ (EQUIPMENT)',
			desc: 'อุปกรณ์เครื่องมือปฏิบัติการและสินทรัพย์ เช่น เครื่องปั่นไฟ ชุด PPE วิทยุสื่อสาร'
		}
	];

	const form = superForm(
		defaults(
			{
				name: '',
				default_class: 'CONSUMABLE',
				description: '',
				deactivated: false
			},
			zod4(itemCategoryInputSchema)
		),
		{
			SPA: true,
			validators: zod4(itemCategoryInputSchema),
			resetForm: false,
			invalidateAll: false,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) return;

				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};

				if (isEdit) {
					if (!categoryQuery.data) {
						toast.error('ไม่พบข้อมูลหมวดหมู่ต้นทาง');
						return;
					}

					if (isProtected) {
						// Protected categories cannot alter system_key/is_protected or create local
						// overrides — default_class is editable here per CR-125 (amends CR-119 FR-04).
						const updatedDoc = {
							...categoryQuery.data,
							name: validated.data.name,
							default_class: validated.data.default_class,
							description: validated.data.description || undefined
						};
						updateMutation.mutate(updatedDoc, {
							onSuccess: () => {
								toast.success(`ปรับปรุงหมวดหมู่ระบบ "${validated.data.name}" สำเร็จ`);
								onsuccess?.();
							},
							onError: (err: Error) => toast.error(err.message)
						});
						return;
					}

					if (basePath.includes('back-office') && !categoryQuery.data.shelter_code) {
						// eslint-disable-next-line @typescript-eslint/no-unused-vars
						const { _rev, ...catData } = categoryQuery.data;
						const overrideDoc = {
							...catData,
							name: validated.data.name,
							default_class: validated.data.default_class,
							description: validated.data.description || undefined,
							deactivated: validated.data.deactivated ?? false,
							shelter_code: shelterCode,
							override: true
						};
						updateMutation.mutate(overrideDoc, {
							onSuccess: () => {
								toast.success(`ปรับแต่งหมวดหมู่ ${validated.data.name} สำหรับศูนย์นี้สำเร็จ`);
								onsuccess?.();
							},
							onError: (err: Error) => toast.error(err.message)
						});
					} else {
						const updatedDoc = {
							...categoryQuery.data,
							name: validated.data.name,
							default_class: validated.data.default_class,
							description: validated.data.description || undefined,
							deactivated: validated.data.deactivated ?? false
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
						{ input: validated.data, ctx, shelterCode },
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
		}
	);

	const { form: formData, submitting, reset } = form;

	let populatedId = $state<string | null>(null);

	// 2. Populate form fields when data loads in edit mode
	$effect(() => {
		if (isEdit && categoryQuery.data && populatedId !== categoryQuery.data._id) {
			populatedId = categoryQuery.data._id;
			$formData.name = categoryQuery.data.name;
			$formData.default_class = categoryQuery.data.default_class ?? 'CONSUMABLE';
			$formData.description = categoryQuery.data.description ?? '';
			$formData.deactivated = categoryQuery.data.deactivated ?? false;
		}
	});

	const isLoading = $derived(isEdit ? categoryQuery.isLoading : false);
	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);
</script>

{#if isLoading}
	<div class="py-12 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลหมวดหมู่...</div>
{:else}
	<form method="POST" use:form.enhance class="space-y-6">
		<div class="space-y-5">
			{#if isProtected && categoryQuery.data}
				<div
					class="flex items-start gap-3 rounded-2xl border border-blue-200/80 bg-blue-50/50 p-4 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200"
				>
					<ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
					<div class="space-y-1">
						<p class="font-bold">หมวดหมู่มาตรฐานของระบบ (System Protected Category)</p>
						<p class="text-blue-700/90 dark:text-blue-300/80">
							หมวดหมู่นี้เป็นโครงสร้างหลักของระบบ ผู้ดูแลระบบส่วนกลางสามารถปรับปรุงชื่อแสดงผล
							คำอธิบาย และประเภทสิ่งของเริ่มต้นได้ แต่ระบบจะคง System Key ไว้ตามมาตรฐานเสมอ
						</p>
					</div>
				</div>
			{/if}

			<!-- Field Group Card -->
			<CatalogFormSection number={1} title="ข้อมูลหมวดหมู่ (Category Details)">
				<!-- Row 1: ชื่อหมวดหมู่ & รหัสระบบ (เฉพาะหมวดหมู่ระบบ) -->
				<div class="grid grid-cols-1 gap-5 {isProtected ? 'md:grid-cols-2' : ''}">
					<Form.Field {form} name="name" class="space-y-2">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-sm font-semibold text-foreground">
									ชื่อหมวดหมู่ (ภาษาไทย) <span class="font-bold text-destructive">*</span>
								</Form.Label>
								<Input
									{...props}
									bind:value={$formData.name}
									placeholder="เช่น อาหารและวัตถุดิบ, น้ำดื่มสะอาด"
									class="w-full rounded-md border-input bg-background"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
					</Form.Field>

					{#if isProtected && categoryQuery.data}
						<div class="space-y-2">
							<span class="text-sm font-semibold text-foreground">รหัสระบบ (System Key)</span>
							<Input
								disabled
								value={categoryQuery.data.system_key || '-'}
								class="w-full rounded-md border-input bg-muted/50 font-bold tracking-wider text-blue-700 uppercase dark:text-blue-300"
							/>
						</div>
					{/if}
				</div>

				<!-- Row 2: ประเภทสิ่งของเริ่มต้น (Default Class) -->
				<div class="space-y-2 border-t border-border/40 pt-4">
					<span class="text-sm font-semibold text-foreground">
						ประเภทสิ่งของเริ่มต้น (Default Class) <span class="font-bold text-destructive">*</span>
					</span>
					<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
						{#each CLASS_OPTIONS as opt (opt.value)}
							<button
								type="button"
								onclick={() => {
									$formData.default_class = opt.value;
								}}
								class="relative flex cursor-pointer flex-col items-start rounded-xl border p-4 text-left transition-all hover:border-slate-300 dark:hover:border-zinc-700 {$formData.default_class ===
								opt.value
									? 'border-[var(--brand-primary)] bg-blue-50/40 ring-1 ring-[var(--brand-primary)]/30 dark:border-blue-500 dark:bg-blue-950/20'
									: 'border-border/60 bg-background/80 dark:border-zinc-800'}"
							>
								<div class="flex w-full items-center justify-between">
									<span class="text-sm font-bold text-foreground">
										{opt.label}
									</span>
									<div
										class="flex h-4 w-4 items-center justify-center rounded-full border {$formData.default_class ===
										opt.value
											? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] dark:border-blue-500 dark:bg-blue-500'
											: 'border-slate-300 dark:border-zinc-600'}"
									>
										{#if $formData.default_class === opt.value}
											<div class="h-1.5 w-1.5 rounded-full bg-white"></div>
										{/if}
									</div>
								</div>
								<span class="mt-2 text-xs leading-relaxed text-muted-foreground">
									{opt.desc}
								</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- Row 3: Description (คำอธิบาย) -->
				<Form.Field {form} name="description" class="space-y-2 border-t border-border/40 pt-4">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-foreground">
								คำอธิบายหมวดหมู่ (Description) <span
									class="text-xs font-normal text-muted-foreground">(ไม่บังคับ)</span
								>
							</Form.Label>
							<Textarea
								{...props}
								bind:value={$formData.description}
								rows={3}
								placeholder="คำอธิบายเพิ่มเติมเพื่อช่วยแยกประเภทและค้นหารายการสิ่งของ"
								class="w-full"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="mt-1 text-xs font-semibold text-destructive" />
				</Form.Field>

				<!-- Status Section for custom categories -->
				{#if isEdit && !isProtected}
					<div class="space-y-2 border-t border-border/40 pt-4">
						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<label
									for="category-deactivated-toggle"
									class="cursor-pointer text-sm font-semibold text-foreground"
								>
									สถานะปิดการใช้งาน (Deactivated)
								</label>
								<p class="text-xs text-muted-foreground">
									หากปิดการใช้งาน หมวดหมู่นี้จะไม่แสดงให้เลือกในการสร้างสิ่งของใหม่
									แต่สิ่งของเดิมที่อยู่ในหมวดนี้จะยังคงอยู่
								</p>
							</div>
							<Checkbox
								id="category-deactivated-toggle"
								checked={$formData.deactivated}
								onCheckedChange={(val) => {
									$formData.deactivated = !!val;
								}}
							/>
						</div>
					</div>
				{/if}
			</CatalogFormSection>
		</div>

		<!-- Action Buttons -->
		<div class="flex items-center gap-3 pt-2">
			<Button
				variant="outline"
				type="button"
				onclick={() => {
					if (oncancel) oncancel();
					else onsuccess?.();
				}}
				class="h-11 rounded-xl border border-slate-200 px-6 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900/50"
			>
				ยกเลิกและย้อนกลับ
			</Button>

			<Button
				type="submit"
				disabled={$submitting || isPending}
				class="flex h-11 items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] px-7 text-sm font-bold text-white shadow-2xs hover:bg-[var(--brand-primary-hover)] dark:shadow-none"
			>
				{#if $submitting || isPending}
					กำลังบันทึกข้อมูล...
				{:else if isEdit}
					บันทึกการแก้ไข
				{:else}
					บันทึก
				{/if}
			</Button>
		</div>
	</form>
{/if}

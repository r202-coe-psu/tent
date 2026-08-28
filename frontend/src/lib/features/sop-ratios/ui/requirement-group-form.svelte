<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import { useItemMasters } from '$lib/features/catalog';
	import {
		STANDARD_UOM_OPTIONS,
		type RequirementGroup,
		type ItemMap
	} from '../domain/requirement-group';
	import { resolveSource, type Source } from '$lib/utils/source';
	import { useSaveRequirementGroup } from '../application/requirement-group-queries';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let {
		group = null,
		isEdit = false,
		shelterCode = '',
		onsuccess,
		oncancel
	}: {
		group?: RequirementGroup | null;
		isEdit?: boolean;
		shelterCode?: string;
		onsuccess?: () => void;
		oncancel?: () => void;
	} = $props();

	const saveMutation = useSaveRequirementGroup();
	const itemMastersQuery = useItemMasters();

	let formGroupId = $state('');
	let formName = $state('');
	let formStandardUom = $state('');
	let formItemMaps = $state<ItemMap[]>([]);
	let formErrors = $state<Record<string, string>>({});

	const itemMasters = $derived(itemMastersQuery.data ?? []);
	const itemOptions = $derived.by(() => {
		return itemMasters.map((im) => ({
			value: im._id,
			label: im.name,
			sku: im.sku,
			base_unit: im.base_unit || im.unit || '',
			keywords: [im.name, im.sku ?? '', im._id].filter(Boolean)
		}));
	});

	function getItemOptions(currentId?: string) {
		const base = [...itemOptions];
		if (currentId && !base.some((b) => b.value === currentId)) {
			const matched = itemMasters.find((im) => im._id === currentId || im.sku === currentId);
			base.unshift({
				value: currentId,
				label: matched?.name ?? currentId,
				sku: matched?.sku,
				base_unit: matched?.base_unit || matched?.unit || '',
				keywords: matched
					? [matched.name, matched.sku ?? '', matched._id].filter(Boolean)
					: [currentId]
			});
		}
		return base;
	}

	function handleItemSelect(index: number, selectedId: string) {
		formItemMaps[index].item_id = selectedId;
		const matched = itemMasters.find((im) => im._id === selectedId || im.sku === selectedId);
		if (matched) {
			formItemMaps[index].base_uom = matched.base_unit || matched.unit || '';
		}
	}

	const sharePercentSum = $derived(
		formItemMaps.reduce((sum, item) => sum + (Number(item.share_percent) || 0), 0)
	);
	const showShareWarning = $derived(
		formItemMaps.length > 0 && Math.abs(sharePercentSum - 100) > 0.01
	);

	$effect(() => {
		if (group) {
			formGroupId = group._id.replace(/^requirement_group:/, '');
			formName = group.name;
			formStandardUom = group.standard_uom;
			formItemMaps = group.item_maps ? JSON.parse(JSON.stringify(group.item_maps)) : [];
		} else {
			formGroupId = '';
			formName = '';
			formStandardUom = '';
			formItemMaps = [];
		}
		formErrors = {};
	});

	$effect(() => {
		if (itemMasters.length > 0 && formItemMaps.length > 0) {
			for (let i = 0; i < formItemMaps.length; i++) {
				const map = formItemMaps[i];
				if (map.item_id && !map.base_uom) {
					const matched = itemMasters.find((im) => im._id === map.item_id);
					if (matched) {
						map.base_uom = matched.base_unit || matched.unit || '';
					}
				}
			}
		}
	});

	function addItemMap() {
		formItemMaps = [
			...formItemMaps,
			{ item_id: '', base_uom: '', conversion_factor: 1, share_percent: 0 }
		];
	}

	function removeItemMap(index: number) {
		formItemMaps = formItemMaps.filter((_, i) => i !== index);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		formErrors = {};

		const cleanGroupId = formGroupId.trim().toUpperCase();
		if (!cleanGroupId) {
			formErrors.groupId = 'กรุณาระบุรหัสกลุ่ม (เช่น FOOD_ENERGY)';
		}
		if (!formName.trim()) {
			formErrors.name = 'กรุณาระบุชื่อกลุ่มความต้องการ';
		}
		if (!formStandardUom.trim()) {
			formErrors.standardUom = 'กรุณาระบุหน่วยนับมาตรฐาน';
		}

		// Validate item maps
		for (let i = 0; i < formItemMaps.length; i++) {
			const item = formItemMaps[i];
			if (!item.item_id.trim()) {
				formErrors[`item_${i}_id`] = 'กรุณาเลือกสิ่งของ';
			}
			if (!item.base_uom.trim()) {
				formErrors[`item_${i}_uom`] = 'กรุณาระบุหน่วยนับ';
			}
			if (Number(item.conversion_factor) <= 0) {
				formErrors[`item_${i}_cf`] = 'ตัวคูณแปลงค่าต้อง > 0';
			}
			if (
				item.share_percent !== undefined &&
				(Number(item.share_percent) < 0 || Number(item.share_percent) > 100)
			) {
				formErrors[`item_${i}_share`] = 'สัดส่วนต้องอยู่ระหว่าง 0-100%';
			}
		}

		if (Object.keys(formErrors).length > 0) {
			return;
		}

		const computedSource: Source = resolveSource(shelterCode);
		const fullId = group ? group._id : `requirement_group:${cleanGroupId}`;
		try {
			await saveMutation.mutateAsync({
				id: fullId,
				input: {
					name: formName.trim(),
					standard_uom: formStandardUom.trim(),
					source: computedSource,
					item_maps: formItemMaps.map((im) => ({
						item_id: im.item_id.trim(),
						base_uom: im.base_uom.trim(),
						conversion_factor: Number(im.conversion_factor),
						share_percent: im.share_percent !== undefined ? Number(im.share_percent) : undefined
					})),
					shelter_code: computedSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
				},
				shelterCode: computedSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
			toast.success(
				isEdit
					? `ปรับปรุงกลุ่มความต้องการ "${formName}" สำเร็จ`
					: `บันทึกกลุ่มความต้องการ "${formName}" สำเร็จ`
			);
			onsuccess?.();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
			toast.error(message);
		}
	}
</script>

<form onsubmit={handleSubmit} class="space-y-6">
	<div class="space-y-5">
		<!-- Field Group Card -->
		<div class="space-y-5 rounded-2xl border border-border/60 bg-muted/20 p-5 sm:p-6">
			<!-- Row 1: ชื่อกลุ่มความต้องการ & รหัสกลุ่ม -->
			<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
				<Field.Field>
					<Field.Label for="form-name">
						ชื่อกลุ่มความต้องการ (ภาษาไทย) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input id="form-name" bind:value={formName} placeholder="เช่น พลังงานอาหาร" />
					{#if formErrors.name}
						<Field.Error>{formErrors.name}</Field.Error>
					{/if}
				</Field.Field>

				<Field.Field>
					<Field.Label for="form-group-id">
						รหัสกลุ่ม (ID) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-group-id"
						bind:value={formGroupId}
						disabled={isEdit}
						placeholder="เช่น FOOD_ENERGY"
						class="font-mono uppercase"
					/>
					{#if formErrors.groupId}
						<Field.Error>{formErrors.groupId}</Field.Error>
					{/if}
				</Field.Field>
			</Field.FieldGroup>

			<!-- Row 2: หน่วยนับมาตรฐาน (Standard UOM) -->
			<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
				<Field.Field>
					<Field.Label for="form-standard-uom">
						หน่วยนับมาตรฐาน (Standard UOM) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Select.Root type="single" bind:value={formStandardUom}>
						<Select.Trigger
							id="form-standard-uom"
							class="h-9 w-full rounded-md border-input bg-background font-mono"
						>
							{STANDARD_UOM_OPTIONS.find((o) => o.value === formStandardUom)?.label ??
								(formStandardUom || '-- เลือกหน่วยนับมาตรฐาน --')}
						</Select.Trigger>
						<Select.Content>
							{#each STANDARD_UOM_OPTIONS as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
							{#if formStandardUom && !STANDARD_UOM_OPTIONS.some((c) => c.value === formStandardUom)}
								<Select.Item value={formStandardUom} label="{formStandardUom} (ระบุเอง)" />
							{/if}
						</Select.Content>
					</Select.Root>
					{#if formErrors.standardUom}
						<Field.Error>{formErrors.standardUom}</Field.Error>
					{/if}
				</Field.Field>
			</Field.FieldGroup>

			<!-- Item Maps section -->
			<div class="space-y-4 border-t pt-4">
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h3 class="text-sm font-semibold text-foreground">
							รายการสินค้าคู่เทียบ (Item Mapping)
						</h3>
						<p class="text-xs text-muted-foreground">
							แปลงความต้องการของกลุ่มสารอาหารเป็นปริมาณสินค้าจริง
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={addItemMap}
						class="flex items-center gap-1 self-start sm:self-auto"
					>
						<Plus class="h-3.5 w-3.5" />
						เพิ่มสินค้าคู่เทียบ
					</Button>
				</div>

				{#if showShareWarning}
					<div
						class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
					>
						⚠️ <strong>ข้อควรระวัง:</strong> ผลรวมสัดส่วนเมนู ({sharePercentSum}%) ไม่เท่ากับ 100%
						(สามารถบันทึกได้ แต่ควรตรวจสอบความถูกต้อง)
					</div>
				{/if}

				{#if formItemMaps.length === 0}
					<div
						class="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground"
					>
						ยังไม่มีรายการสินค้าคู่เทียบ คลิก "+ เพิ่มสินค้าคู่เทียบ" ด้านบนเพื่อเพิ่มข้อมูล
					</div>
				{:else}
					<div class="space-y-3">
						{#each formItemMaps as itemMap, index (index)}
							<div
								class="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-background/80 p-3.5 text-xs sm:flex-nowrap"
							>
								<div class="min-w-[200px] flex-1">
									<label
										for={`item-map-id-${index}`}
										class="block pb-1 font-semibold text-foreground">สิ่งของ</label
									>
									<Combobox
										items={getItemOptions(itemMap.item_id)}
										bind:value={() => itemMap.item_id, (v) => handleItemSelect(index, v)}
										placeholder="-- เลือกสิ่งของ --"
										searchPlaceholder="ค้นหาชื่อสิ่งของ หรือ SKU..."
										emptyText="ไม่พบรายการสิ่งของ"
										disabled={itemMastersQuery.isLoading}
										class="h-9 w-full justify-between rounded-md border-input bg-background px-3 text-xs font-normal shadow-sm"
									>
										{#snippet children({ item })}
											<div class="flex w-full items-center justify-between gap-2">
												<div class="flex min-w-0 flex-col text-left">
													<span class="truncate text-xs font-semibold text-foreground"
														>{item.label}</span
													>
													{#if item.sku}
														<span class="truncate font-mono text-[10px] text-muted-foreground"
															>{item.sku}</span
														>
													{/if}
												</div>
												{#if item.base_unit}
													<span
														class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
													>
														{item.base_unit}
													</span>
												{/if}
											</div>
										{/snippet}
									</Combobox>
									{#if formErrors[`item_${index}_id`]}
										<p class="mt-1 text-[10px] text-destructive">
											{formErrors[`item_${index}_id`]}
										</p>
									{/if}
								</div>

								<div class="w-full sm:w-28">
									<label
										for={`item-map-uom-${index}`}
										class="block pb-1 font-semibold text-foreground">หน่วยนับ</label
									>
									<Input
										id={`item-map-uom-${index}`}
										bind:value={itemMap.base_uom}
										placeholder="ดึงจากสิ่งของ"
										readonly
										class="h-9 cursor-not-allowed bg-muted font-medium text-muted-foreground"
									/>
									{#if formErrors[`item_${index}_uom`]}
										<p class="mt-1 text-[10px] text-destructive">
											{formErrors[`item_${index}_uom`]}
										</p>
									{/if}
								</div>

								<div class="w-full sm:w-32">
									<label
										for={`item-map-cf-${index}`}
										class="block pb-1 font-semibold text-foreground">ตัวคูณแปลงค่า</label
									>
									<Input
										id={`item-map-cf-${index}`}
										type="number"
										step="any"
										bind:value={itemMap.conversion_factor}
										placeholder="1"
									/>
									{#if formErrors[`item_${index}_cf`]}
										<p class="mt-1 text-[10px] text-destructive">
											{formErrors[`item_${index}_cf`]}
										</p>
									{/if}
								</div>

								<div class="w-full sm:w-28">
									<label
										for={`item-map-share-${index}`}
										class="block pb-1 font-semibold text-foreground">สัดส่วน (%)</label
									>
									<Input
										id={`item-map-share-${index}`}
										type="number"
										step="any"
										bind:value={itemMap.share_percent}
										placeholder="100"
									/>
									{#if formErrors[`item_${index}_share`]}
										<p class="mt-1 text-[10px] text-destructive">
											{formErrors[`item_${index}_share`]}
										</p>
									{/if}
								</div>

								<Button
									type="button"
									variant="ghost"
									size="icon"
									class="shrink-0 text-destructive hover:bg-destructive/10"
									onclick={() => removeItemMap(index)}
									aria-label="ลบสินค้าคู่เทียบ"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Action Buttons -->
	<div class="flex items-center gap-3 pt-2">
		<Button
			variant="outline"
			type="button"
			onclick={oncancel}
			class="rounded-xl border border-slate-200 px-6 py-6 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900/50"
		>
			ยกเลิกและย้อนกลับ
		</Button>
		<Button
			type="submit"
			disabled={saveMutation.isPending}
			class="flex items-center gap-1.5 rounded-xl bg-[#002f6c] px-7 py-6 text-sm font-bold text-white shadow-md shadow-[#002f6c]/10 hover:bg-[#00204d] dark:shadow-none"
		>
			{#if saveMutation.isPending}
				กำลังบันทึก...
			{:else if isEdit}
				บันทึกการแก้ไข
			{:else}
				บันทึก
			{/if}
		</Button>
	</div>
</form>

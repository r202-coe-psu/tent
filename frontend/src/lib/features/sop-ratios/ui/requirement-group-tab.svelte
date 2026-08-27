<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		useRequirementGroups,
		useSaveRequirementGroup,
		useDeleteRequirementGroup
	} from '../application/requirement-group-queries';
	import type { RequirementGroup, ItemMap } from '../domain/requirement-group';

	let {
		shelterCode = '',
		isSA = false,
		canEditOverride = false
	}: {
		shelterCode?: string;
		isSA?: boolean;
		canEditOverride?: boolean;
	} = $props();

	const reqGroupsQuery = useRequirementGroups(() => shelterCode);
	const saveMutation = useSaveRequirementGroup();
	const deleteMutation = useDeleteRequirementGroup();

	let search = $state('');
	let isModalOpen = $state(false);
	let editingId = $state<string | null>(null);

	// Form State
	let formGroupId = $state('');
	let formName = $state('');
	let formStandardUom = $state('');
	let formSource = $state<'SPHERE_BASELINE' | 'SHELTER_OVERRIDE'>('SPHERE_BASELINE');
	let formItemMaps = $state<ItemMap[]>([]);
	let formErrors = $state<Record<string, string>>({});

	const groups = $derived(reqGroupsQuery.data ?? []);
	const filteredGroups = $derived(
		groups.filter(
			(g) =>
				g.name.toLowerCase().includes(search.toLowerCase()) ||
				g._id.toLowerCase().includes(search.toLowerCase()) ||
				g.standard_uom.toLowerCase().includes(search.toLowerCase())
		)
	);

	const sharePercentSum = $derived(
		formItemMaps.reduce((sum, item) => sum + (Number(item.share_percent) || 0), 0)
	);
	const showShareWarning = $derived(
		formItemMaps.length > 0 && Math.abs(sharePercentSum - 100) > 0.01
	);

	function openCreateModal() {
		editingId = null;
		formGroupId = '';
		formName = '';
		formStandardUom = '';
		formSource = shelterCode && !isSA ? 'SHELTER_OVERRIDE' : 'SPHERE_BASELINE';
		formItemMaps = [];
		formErrors = {};
		isModalOpen = true;
	}

	function openEditModal(group: RequirementGroup) {
		editingId = group._id;
		formGroupId = group._id.replace(/^requirement_group:/, '');
		formName = group.name;
		formStandardUom = group.standard_uom;
		formSource = group.source;
		formItemMaps = group.item_maps ? JSON.parse(JSON.stringify(group.item_maps)) : [];
		formErrors = {};
		isModalOpen = true;
	}

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
				formErrors[`item_${i}_id`] = 'กรุณาระบุรหัสสินค้า';
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

		const fullId = editingId ? editingId : `requirement_group:${cleanGroupId}`;
		await saveMutation.mutateAsync({
			id: fullId,
			input: {
				name: formName.trim(),
				standard_uom: formStandardUom.trim(),
				source: formSource,
				item_maps: formItemMaps.map((im) => ({
					item_id: im.item_id.trim(),
					base_uom: im.base_uom.trim(),
					conversion_factor: Number(im.conversion_factor),
					share_percent: im.share_percent !== undefined ? Number(im.share_percent) : undefined
				})),
				shelter_code: formSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			},
			shelterCode: formSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
		});

		isModalOpen = false;
	}

	async function handleDelete(group: RequirementGroup) {
		if (!confirm(`คุณต้องการลบกลุ่มความต้องการ "${group.name}" (${group._id}) หรือไม่?`)) {
			return;
		}
		await deleteMutation.mutateAsync({
			id: group._id,
			shelterCode: group.source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
		});
	}
</script>

<section class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6">
	<header class="mb-6 flex flex-col gap-4">
		<div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
			<div>
				<h1 class="text-xl font-semibold">กลุ่มสารอาหาร & หน่วยนับมาตรฐาน (Requirement Groups)</h1>
				<p class="text-sm text-muted-foreground">
					จัดการกลุ่มความต้องการสารอาหาร หน่วยนับกลาง และรายการสินค้าคู่เทียบ (Item Mapping)
				</p>
			</div>

			<div class="flex items-center gap-2">
				<div class="relative w-full sm:w-64">
					<Input
						bind:value={search}
						type="search"
						placeholder="ค้นหากลุ่มความต้องการ..."
						class="pl-9"
						aria-label="ค้นหากลุ่มความต้องการ"
					/>
					<svg
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<circle cx="11" cy="11" r="8" />
						<path d="m21 21-4.3-4.3" />
					</svg>
				</div>

				{#if isSA || canEditOverride}
					<Button onclick={openCreateModal} class="shrink-0">เพิ่มกลุ่มความต้องการ</Button>
				{/if}
			</div>
		</div>
	</header>

	{#if reqGroupsQuery.isLoading}
		<div class="flex min-h-80 items-center justify-center">
			<div
				class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
			></div>
		</div>
	{:else if filteredGroups.length === 0}
		<div class="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
			<p class="font-medium">ไม่พบข้อมูลกลุ่มความต้องการ</p>
			{#if isSA || canEditOverride}
				<p class="mt-1 text-sm">คลิกปุ่ม "เพิ่มกลุ่มความต้องการ" เพื่อเริ่มต้นกำหนดกลุ่มสารอาหาร</p>
			{/if}
		</div>
	{:else}
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-left text-sm">
				<thead class="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase">
					<tr>
						<th class="p-3">รหัสกลุ่ม (ID)</th>
						<th class="p-3">ชื่อกลุ่มความต้องการ</th>
						<th class="p-3">หน่วยนับมาตรฐาน</th>
						<th class="p-3">สินค้าคู่เทียบ (Item Maps)</th>
						<th class="p-3">แหล่งที่มา</th>
						<th class="p-3 text-right">การจัดการ</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each filteredGroups as group (group._id)}
						<tr class="hover:bg-muted/30">
							<td class="p-3 font-mono font-medium text-foreground">{group._id}</td>
							<td class="p-3 font-medium">{group.name}</td>
							<td class="p-3">
								<span class="rounded bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
									{group.standard_uom}
								</span>
							</td>
							<td class="p-3">
								{#if (group.item_maps ?? []).length > 0}
									<span class="text-xs text-muted-foreground">
										{(group.item_maps ?? []).length} รายการ ({(group.item_maps ?? [])
											.map((m) => m.item_id)
											.join(', ')})
									</span>
								{:else}
									<span class="text-xs text-muted-foreground italic">ไม่มีสินค้าคู่เทียบ</span>
								{/if}
							</td>
							<td class="p-3">
								{#if group.source === 'SHELTER_OVERRIDE'}
									<span
										class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
									>
										ศูนย์พักพิง {group.shelter_code ?? ''}
									</span>
								{:else}
									<span
										class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
									>
										ส่วนกลาง (Sphere Baseline)
									</span>
								{/if}
							</td>
							<td class="p-3 text-right">
								<div class="flex items-center justify-end gap-2">
									{#if isSA || (canEditOverride && group.source === 'SHELTER_OVERRIDE')}
										<Button variant="outline" size="sm" onclick={() => openEditModal(group)}>
											แก้ไข
										</Button>
										<Button variant="destructive" size="sm" onclick={() => handleDelete(group)}>
											ลบ
										</Button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

{#if isModalOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="req-group-modal-title"
	>
		<div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card p-6 shadow-xl">
			<h2 id="req-group-modal-title" class="text-lg font-semibold">
				{editingId ? 'แก้ไขกลุ่มความต้องการ' : 'เพิ่มกลุ่มความต้องการ'}
			</h2>

			<form onsubmit={handleSubmit} class="mt-4 space-y-4">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="form-group-id" class="block text-sm font-medium">
							รหัสกลุ่ม (ID) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-group-id"
							bind:value={formGroupId}
							disabled={!!editingId}
							placeholder="เช่น FOOD_ENERGY"
							class="mt-1 font-mono uppercase"
						/>
						{#if formErrors.groupId}
							<p class="mt-1 text-xs text-destructive">{formErrors.groupId}</p>
						{/if}
					</div>

					<div>
						<label for="form-name" class="block text-sm font-medium">
							ชื่อกลุ่มความต้องการ (ภาษาไทย) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-name"
							bind:value={formName}
							placeholder="เช่น พลังงานอาหาร"
							class="mt-1"
						/>
						{#if formErrors.name}
							<p class="mt-1 text-xs text-destructive">{formErrors.name}</p>
						{/if}
					</div>

					<div>
						<label for="form-standard-uom" class="block text-sm font-medium">
							หน่วยนับมาตรฐาน (Standard UOM) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-standard-uom"
							bind:value={formStandardUom}
							placeholder="เช่น kcal, gram, litre"
							class="mt-1 font-mono"
						/>
						{#if formErrors.standardUom}
							<p class="mt-1 text-xs text-destructive">{formErrors.standardUom}</p>
						{/if}
					</div>

					<div>
						<label for="form-source" class="block text-sm font-medium"> แหล่งที่มา (Source) </label>
						<select
							id="form-source"
							bind:value={formSource}
							disabled={!isSA}
							class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
						>
							<option value="SPHERE_BASELINE">ส่วนกลาง (SPHERE_BASELINE)</option>
							<option value="SHELTER_OVERRIDE">ศูนย์พักพิง (SHELTER_OVERRIDE)</option>
						</select>
					</div>
				</div>

				<!-- Item Maps section -->
				<div class="border-t pt-4">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-sm font-semibold">รายการสินค้าคู่เทียบ (Item Mapping)</h3>
							<p class="text-xs text-muted-foreground">
								แปลงความต้องการของกลุ่มสารอาหารเป็นปริมาณสินค้าจริง
							</p>
						</div>
						<Button type="button" variant="outline" size="sm" onclick={addItemMap}>
							+ เพิ่มสินค้าคู่เทียบ
						</Button>
					</div>

					{#if showShareWarning}
						<div
							class="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
						>
							⚠️ <strong>ข้อควรระวัง:</strong> ผลรวมสัดส่วนเมนู ({sharePercentSum}%) ไม่เท่ากับ 100%
							(สามารถบันทึกได้ แต่ควรตรวจสอบความถูกต้อง)
						</div>
					{/if}

					<div class="mt-3 space-y-3">
						{#each formItemMaps as itemMap, index (index)}
							<div
								class="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3 text-xs sm:flex-nowrap"
							>
								<div class="flex-1">
									<label for={`item-map-id-${index}`} class="block font-medium"
										>รหัสสินค้า (Item ID)</label
									>
									<Input
										id={`item-map-id-${index}`}
										bind:value={itemMap.item_id}
										placeholder="e.g. item_master:RICE_5KG"
										class="mt-1 text-xs"
									/>
									{#if formErrors[`item_${index}_id`]}
										<p class="mt-0.5 text-[10px] text-destructive">
											{formErrors[`item_${index}_id`]}
										</p>
									{/if}
								</div>

								<div class="w-24">
									<label for={`item-map-uom-${index}`} class="block font-medium"
										>หน่วยนับพื้นฐาน</label
									>
									<Input
										id={`item-map-uom-${index}`}
										bind:value={itemMap.base_uom}
										placeholder="ถุง/kg"
										class="mt-1 text-xs"
									/>
									{#if formErrors[`item_${index}_uom`]}
										<p class="mt-0.5 text-[10px] text-destructive">
											{formErrors[`item_${index}_uom`]}
										</p>
									{/if}
								</div>

								<div class="w-28">
									<label for={`item-map-cf-${index}`} class="block font-medium">ตัวคูณแปลงค่า</label
									>
									<Input
										id={`item-map-cf-${index}`}
										type="number"
										step="any"
										bind:value={itemMap.conversion_factor}
										placeholder="1"
										class="mt-1 text-xs"
									/>
									{#if formErrors[`item_${index}_cf`]}
										<p class="mt-0.5 text-[10px] text-destructive">
											{formErrors[`item_${index}_cf`]}
										</p>
									{/if}
								</div>

								<div class="w-24">
									<label for={`item-map-share-${index}`} class="block font-medium"
										>สัดส่วน (%)</label
									>
									<Input
										id={`item-map-share-${index}`}
										type="number"
										step="any"
										bind:value={itemMap.share_percent}
										placeholder="100"
										class="mt-1 text-xs"
									/>
									{#if formErrors[`item_${index}_share`]}
										<p class="mt-0.5 text-[10px] text-destructive">
											{formErrors[`item_${index}_share`]}
										</p>
									{/if}
								</div>

								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="mt-4 text-destructive hover:bg-destructive/10"
									onclick={() => removeItemMap(index)}
								>
									ลบ
								</Button>
							</div>
						{/each}
					</div>
				</div>

				<div class="flex justify-end gap-2 border-t pt-4">
					<Button type="button" variant="outline" onclick={() => (isModalOpen = false)}>
						ยกเลิก
					</Button>
					<Button type="submit" disabled={saveMutation.isPending}>
						{saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
					</Button>
				</div>
			</form>
		</div>
	</div>
{/if}

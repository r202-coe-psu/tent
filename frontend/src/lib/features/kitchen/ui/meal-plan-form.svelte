<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Users from '@lucide/svelte/icons/users';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import {
		useCreateMealPlanCalc,
		useUpdateMealPlanCalc,
		useOccupancyHeadcount,
		calculateMealIngredients,
		calculateMealIngredientsFromRecipe,
		calculateMealIngredientsFromCustom,
		DEFAULT_RICE_G_PER_PERSON_MEAL,
		RECIPE_LABELS,
		MEAL_PERIOD_LABELS,
		type MealPeriod,
		type MealPlan,
		type MealPlanHeadcount,
		type CustomIngredientInput
	} from '$lib/features/kitchen';
	import { useActiveSopProfile } from '$lib/features/sop-ratios';
	import { useRecipes, useItemMasters } from '$lib/features/catalog';
	import { useSupplyItems } from '$lib/features/supply';
	import { useStockBalance } from '$lib/features/operations';

	// `plan` present ⇒ edit an existing draft in place (date/meal/_id stay fixed,
	// since meal_plan:{date}:{meal} is deterministic); absent ⇒ create a new one.
	// `defaultMode` only applies the first time the dialog opens in create mode —
	// after that the toggle below is the user's to change.
	let {
		open = $bindable(false),
		plan = null,
		defaultMode = 'sop'
	}: {
		open: boolean;
		plan?: MealPlan | null;
		defaultMode?: 'sop' | 'recipe' | 'custom';
	} = $props();
	const isEdit = $derived(plan !== null);

	let date = $state(new Date().toISOString().slice(0, 10));
	let meal = $state<MealPeriod>('lunch');
	let sourceMode = $state<'sop' | 'recipe' | 'custom'>('sop');
	let recipeId = $state<string | null>(null);
	let customLabel = $state('');
	let customRows = $state<{ itemId: string | null; qtyPerPerson: number }[]>([
		{ itemId: null, qtyPerPerson: 0 }
	]);
	let total = $state(0);
	let halal = $state(0);
	let softFood = $state(0);
	let infant = $state(0);
	let overrideReason = $state('');

	const sopProfile = useActiveSopProfile();
	const occupancy = useOccupancyHeadcount();
	const createCalc = useCreateMealPlanCalc();
	const updateCalc = useUpdateMealPlanCalc();
	const recipes = useRecipes();
	const itemMasters = useItemMasters();
	const supplyItems = useSupplyItems();
	const stockBalance = useStockBalance();

	function itemLabel(itemMasterId: string): string {
		return itemMasters.data?.find((im) => im._id === itemMasterId)?.name ?? itemMasterId;
	}

	function supplyItemLabel(itemId: string): string {
		return supplyItems.data?.find((i) => i._id === itemId)?.name ?? itemId;
	}

	function onHand(itemId: string): string {
		return stockBalance.data?.get(itemId) ?? '0';
	}

	function addCustomRow() {
		customRows = [...customRows, { itemId: null, qtyPerPerson: 0 }];
	}

	function removeCustomRow(index: number) {
		customRows = customRows.filter((_, i) => i !== index);
	}

	// Only rows with both a picked item and a positive qty become real
	// ingredients — an unfinished row (item not yet picked) is silently dropped
	// rather than blocking the whole form.
	const customIngredients = $derived.by((): CustomIngredientInput[] => {
		return customRows.flatMap((row) => {
			if (!row.itemId || row.qtyPerPerson <= 0) return [];
			const item = supplyItems.data?.find((i) => i._id === row.itemId);
			if (!item) return [];
			return [{ item_id: item._id, unit: item.unit, qty_per_person: row.qtyPerPerson }];
		});
	});

	// Auto-fill headcount from live occupancy once per open (T-06 source, create
	// mode only). After that the fields are the user's to edit; the "ใช้ยอดล่าสุด"
	// button re-syncs. Edit mode prefills from the plan being edited instead.
	let applied = $state(false);
	let appliedMode = $state(false);
	let editedPlanId = $state<string | null>(null);

	function fillFromOccupancy(h: MealPlanHeadcount) {
		total = h.total;
		halal = h.halal;
		softFood = h.soft_food;
		infant = h.infant;
	}

	// Detects which mode actually produced a stored plan's recipes, so editing
	// opens on the matching section instead of always falling back to SOP.
	// BOM recipe_ids are catalog `item_master:*`; custom recipe_ids are real
	// `item:*` supply_items and carry `unit`; SOP (rice/egg/vegetable) recipes
	// have neither.
	function planSourceMode(p: MealPlan): 'sop' | 'recipe' | 'custom' {
		if (p.recipes.some((r) => r.recipe_id.startsWith('item_master:'))) return 'recipe';
		if (p.recipes.some((r) => r.unit != null)) return 'custom';
		return 'sop';
	}

	$effect(() => {
		if (!open) {
			applied = false;
			appliedMode = false;
			editedPlanId = null;
			return;
		}
		if (plan) {
			if (editedPlanId !== plan._id) {
				date = plan.date;
				meal = plan.meal;
				sourceMode = planSourceMode(plan);
				// BOM mode: which catalog Recipe produced it isn't stored — needs a
				// re-pick, recipeId stays null. Custom mode: each row IS fully
				// reconstructable (qty_per_person = planned_qty / headcount.total).
				recipeId = null;
				customLabel = plan.label ?? '';
				customRows =
					sourceMode === 'custom'
						? plan.recipes.map((r) => ({
								itemId: r.recipe_id,
								qtyPerPerson: r.planned_qty / plan.headcount.total
							}))
						: [{ itemId: null, qtyPerPerson: 0 }];
				fillFromOccupancy(plan.headcount);
				overrideReason = plan.override_reason ?? '';
				editedPlanId = plan._id;
			}
			return;
		}
		if (!appliedMode) {
			sourceMode = defaultMode;
			recipeId = null;
			customLabel = '';
			customRows = [{ itemId: null, qtyPerPerson: 0 }];
			appliedMode = true;
		}
		if (!applied && occupancy.data) {
			fillFromOccupancy(occupancy.data);
			overrideReason = '';
			applied = true;
		}
	});

	const headcount = $derived<MealPlanHeadcount>({
		total,
		halal,
		soft_food: softFood,
		infant
	});

	// Each sub-count is bounded by total independently (orthogonal dimensions).
	const subCountsValid = $derived(halal <= total && softFood <= total && infant <= total);

	// Overridden = final headcount differs from the live occupancy snapshot.
	const isOverridden = $derived.by(() => {
		const o = occupancy.data;
		if (!o) return false;
		return (
			total !== o.total || halal !== o.halal || softFood !== o.soft_food || infant !== o.infant
		);
	});

	const overrideReasonValid = $derived(!isOverridden || overrideReason.trim().length > 0);

	function resetToOccupancy() {
		if (occupancy.data) {
			fillFromOccupancy(occupancy.data);
			overrideReason = '';
		}
	}

	const selectedRecipe = $derived(recipes.data?.find((r) => r._id === recipeId) ?? null);

	const preview = $derived.by(() => {
		if (!sopProfile.data || total <= 0) return null;
		try {
			if (sourceMode === 'recipe') {
				if (!selectedRecipe) return null;
				const itemUnits = Object.fromEntries(
					(itemMasters.data ?? []).map((im) => [im._id, im.base_unit])
				);
				return calculateMealIngredientsFromRecipe(
					selectedRecipe,
					headcount,
					itemUnits,
					sopProfile.data._id,
					sopProfile.data.version,
					new Date().toISOString()
				);
			}
			if (sourceMode === 'custom') {
				if (!customIngredients.length) return null;
				return calculateMealIngredientsFromCustom(
					customIngredients,
					headcount,
					sopProfile.data._id,
					sopProfile.data.version,
					new Date().toISOString()
				);
			}
			return calculateMealIngredients(
				headcount,
				DEFAULT_RICE_G_PER_PERSON_MEAL,
				sopProfile.data._id,
				sopProfile.data.version,
				new Date().toISOString()
			);
		} catch {
			return null;
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		const label =
			sourceMode === 'custom'
				? customLabel.trim() || undefined
				: sourceMode === 'recipe'
					? (selectedRecipe?.label ?? undefined)
					: undefined;
		try {
			if (plan) {
				await updateCalc.mutateAsync({
					plan,
					label,
					headcount,
					override_reason: isOverridden ? overrideReason.trim() : null,
					recipeId: sourceMode === 'recipe' ? (recipeId ?? undefined) : undefined,
					custom: sourceMode === 'custom' ? customIngredients : undefined
				});
				toast.success(`แก้ไขแผน ${MEAL_PERIOD_LABELS[meal]} วันที่ ${date} แล้ว`);
			} else {
				await createCalc.mutateAsync({
					date,
					meal,
					label,
					headcount,
					override_reason: isOverridden ? overrideReason.trim() : null,
					recipeId: sourceMode === 'recipe' ? (recipeId ?? undefined) : undefined,
					custom: sourceMode === 'custom' ? customIngredients : undefined,
					ctx
				});
				toast.success(`สร้างแผน ${MEAL_PERIOD_LABELS[meal]} วันที่ ${date} แล้ว`);
			}
			open = false;
			overrideReason = '';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>
				{#if sourceMode === 'recipe'}
					{isEdit ? 'แก้ไขแผนจากสูตรมาตรฐาน (BOM)' : 'สร้างแผนจากสูตรมาตรฐาน (BOM)'}
				{:else if sourceMode === 'custom'}
					{isEdit ? 'แก้ไขแผนแบบกำหนดสูตรเอง (Custom)' : 'สร้างแผนแบบกำหนดสูตรเอง (Custom)'}
				{:else}
					{isEdit ? 'แก้ไขแผนอาหาร (SOP)' : 'สร้างแผนอาหาร (SOP)'}
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				คำนวณรายการวัตถุดิบอัตโนมัติจากยอดผู้พักพิงจริง ×
				{#if sourceMode === 'recipe'}
					สูตรมาตรฐาน (BOM)
				{:else if sourceMode === 'custom'}
					วัตถุดิบที่กำหนดเอง
				{:else}
					SOP ratio
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<Label for="mp-date">วันที่</Label>
					<Input id="mp-date" type="date" bind:value={date} required disabled={isEdit} />
				</div>
				<div class="space-y-1.5">
					<Label for="mp-meal">มื้ออาหาร</Label>
					<select
						id="mp-meal"
						bind:value={meal}
						disabled={isEdit}
						class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-50"
					>
						{#each Object.entries(MEAL_PERIOD_LABELS) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</div>
			</div>

			{#if sourceMode === 'custom'}
				<div class="space-y-2">
					<div class="space-y-1.5">
						<Label for="mp-custom-label">ชื่อเมนู (ไม่บังคับ)</Label>
						<Input id="mp-custom-label" placeholder="เช่น ข้าวไก่กรอบ" bind:value={customLabel} />
					</div>
					<Label>วัตถุดิบ</Label>
					{#if supplyItems.isPending}
						<p class="text-xs text-muted-foreground">กำลังโหลดรายการสินค้า...</p>
					{:else if !supplyItems.data?.length}
						<p class="text-xs text-destructive">ยังไม่มีรายการสินค้าในคลัง</p>
					{:else}
						<div class="space-y-2">
							{#each customRows as row, i (i)}
								<div class="flex items-center gap-2">
									<select
										bind:value={row.itemId}
										class="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none"
									>
										<option value={null} disabled>เลือกวัตถุดิบ...</option>
										{#each supplyItems.data as item (item._id)}
											<option value={item._id}>{item.name} ({item.unit})</option>
										{/each}
									</select>
									<Input
										type="number"
										min="0"
										step="any"
										class="w-28"
										placeholder="ต่อคน"
										bind:value={row.qtyPerPerson}
									/>
									<Button
										type="button"
										size="sm"
										variant="outline"
										class="text-destructive hover:text-destructive"
										onclick={() => removeCustomRow(i)}
										disabled={customRows.length <= 1}
									>
										<Trash2 class="h-3.5 w-3.5" />
									</Button>
								</div>
								{#if row.itemId}
									<p class="pl-0.5 text-xs text-muted-foreground">
										ยอดคลังสแตนบาย ณ ศูนย์: <span class="font-medium text-foreground"
											>{onHand(row.itemId)}</span
										>
										{supplyItems.data.find((i) => i._id === row.itemId)?.unit}
									</p>
								{/if}
							{/each}
							<Button type="button" size="sm" variant="outline" onclick={addCustomRow}>
								<Plus class="mr-1 h-3.5 w-3.5" />
								เพิ่มวัตถุดิบ
							</Button>
						</div>
					{/if}
				</div>
			{/if}

			{#if sourceMode === 'recipe'}
				<div class="space-y-1.5">
					<Label for="mp-recipe">สูตรมาตรฐาน (จากฐานสูตร BOM)</Label>
					{#if isEdit}
						<p class="text-xs text-amber-600">
							แผนเดิมไม่ได้เก็บว่าใช้สูตรไหน — กรุณาเลือกสูตรใหม่อีกครั้ง
						</p>
					{/if}
					{#if recipes.isPending}
						<p class="text-xs text-muted-foreground">กำลังโหลดสูตร...</p>
					{:else if !recipes.data?.length}
						<p class="text-xs text-destructive">
							ยังไม่มีสูตรในฐานสูตร BOM — สร้างที่หน้า "ฐานสูตร BOM" ก่อน
						</p>
					{:else}
						<select
							id="mp-recipe"
							bind:value={recipeId}
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none"
						>
							<option value={null} disabled>เลือกสูตร...</option>
							{#each recipes.data as r (r._id)}
								<option value={r._id}>{r.label} ({r.standard_portions} ที่)</option>
							{/each}
						</select>
					{/if}
				</div>
			{/if}

			<!-- Live occupancy source (T-06) -->
			<div
				class="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs"
			>
				<span class="flex items-center gap-1.5 text-muted-foreground">
					<Users class="h-3.5 w-3.5" />
					{#if occupancy.isPending}
						กำลังอ่านยอดผู้พักพิง...
					{:else}
						ยอดผู้พักพิงล่าสุด (checked-in): <span class="font-semibold text-foreground"
							>{occupancy.data?.total ?? 0}</span
						> คน
					{/if}
				</span>
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-50"
					onclick={resetToOccupancy}
					disabled={!occupancy.data}
				>
					<RefreshCw class="h-3 w-3" />
					ใช้ยอดล่าสุด
				</button>
			</div>

			<div class="space-y-1.5">
				<Label for="mp-total">จำนวนผู้พักพิงทั้งหมด (คน)</Label>
				<Input id="mp-total" type="number" min="1" bind:value={total} required />
			</div>

			<div class="grid grid-cols-3 gap-3">
				<div class="space-y-1.5">
					<Label for="mp-halal" class="text-xs">ฮาลาล</Label>
					<Input id="mp-halal" type="number" min="0" bind:value={halal} />
				</div>
				<div class="space-y-1.5">
					<Label for="mp-soft" class="text-xs">อาหารอ่อน</Label>
					<Input id="mp-soft" type="number" min="0" bind:value={softFood} />
				</div>
				<div class="space-y-1.5">
					<Label for="mp-infant" class="text-xs">ทารก</Label>
					<Input id="mp-infant" type="number" min="0" bind:value={infant} />
				</div>
			</div>

			{#if !subCountsValid}
				<p class="text-xs text-destructive">
					ยอดฮาลาล / อาหารอ่อน / ทารก แต่ละช่องต้องไม่เกินจำนวนทั้งหมด
				</p>
			{/if}

			<!-- Manual override reason — required when headcount deviates from occupancy -->
			{#if isOverridden}
				<div class="space-y-1.5">
					<Label for="mp-override" class="text-xs text-amber-700">
						เหตุผลที่แก้ยอดต่างจาก occupancy (บังคับ)
					</Label>
					<textarea
						id="mp-override"
						bind:value={overrideReason}
						rows="2"
						placeholder="เช่น มีอาสาสมัคร/ผู้มาช่วยงานเพิ่ม 20 คน"
						class="flex w-full rounded-md border border-amber-300 bg-transparent px-3 py-1.5 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none"
					></textarea>
				</div>
			{/if}

			{#if sopProfile.isPending}
				<p class="text-xs text-muted-foreground">กำลังโหลด SOP profile...</p>
			{:else if !sopProfile.data}
				<p class="text-xs text-destructive">
					ไม่มี SOP profile ในระบบ — ติดต่อผู้ดูแลระบบเพื่อสร้างค่ามาตรฐานส่วนกลางก่อน
				</p>
			{:else if preview}
				<div class="space-y-1 rounded-md border bg-muted/50 p-3">
					<p class="text-xs font-medium text-muted-foreground">ผลการคำนวณ</p>
					{#each preview.recipes as recipe (recipe.recipe_id)}
						{@const meta =
							sourceMode === 'recipe'
								? { label: itemLabel(recipe.recipe_id), unit: recipe.unit ?? '' }
								: sourceMode === 'custom'
									? { label: supplyItemLabel(recipe.recipe_id), unit: recipe.unit ?? '' }
									: (RECIPE_LABELS[recipe.recipe_id] ?? { label: recipe.recipe_id, unit: '' })}
						{@const shortfall =
							sourceMode === 'custom' ? recipe.planned_qty - Number(onHand(recipe.recipe_id)) : 0}
						<p class="text-sm font-semibold">
							{meta.label}
							{recipe.planned_qty.toLocaleString()}
							{meta.unit}
						</p>
						{#if shortfall > 0}
							<p class="text-xs text-amber-600">
								⚠ ต้องการมากกว่ายอดคลัง — มี {onHand(recipe.recipe_id)}
								{meta.unit} (ขาด {shortfall.toLocaleString()}
								{meta.unit}) — ยังสร้างแผนได้ แต่ตอนเบิกจริงจะได้แค่บางส่วน
							</p>
						{/if}
					{/each}
					<p class="text-xs text-muted-foreground">
						{#if sourceMode === 'recipe'}
							สูตร: {selectedRecipe?.label} · มาตรฐาน {selectedRecipe?.standard_portions} ที่
						{:else if sourceMode === 'custom'}
							{customLabel.trim() || 'เมนูกำหนดเอง'} · วัตถุดิบจากคลังสินค้าจริง
						{:else}
							SOP: {sopProfile.data.name} v{sopProfile.data.version}
							· ข้าว {DEFAULT_RICE_G_PER_PERSON_MEAL} ก./คน/มื้อ (ค่าครัว)
						{/if}
					</p>
					{#if sourceMode === 'recipe'}
						<p class="text-xs text-amber-600">
							⚠ แผนจากสูตร BOM ยังเบิกวัตถุดิบไม่ได้จริง — วัตถุดิบยังไม่เชื่อมกับระบบคลังสินค้า
						</p>
					{/if}
				</div>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
				<Button
					type="submit"
					disabled={createCalc.isPending ||
						updateCalc.isPending ||
						total <= 0 ||
						!sopProfile.data ||
						!subCountsValid ||
						!overrideReasonValid ||
						(sourceMode === 'recipe' && !recipeId) ||
						(sourceMode === 'custom' && customIngredients.length === 0)}
				>
					{#if isEdit}
						{updateCalc.isPending ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
					{:else}
						{createCalc.isPending ? 'กำลังบันทึก...' : 'สร้างแผน (draft)'}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

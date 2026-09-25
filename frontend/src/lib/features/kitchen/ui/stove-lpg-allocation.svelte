<script lang="ts">
	import Flame from '@lucide/svelte/icons/flame';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		calculateGasConsumptionKg,
		gasCylinderBalance,
		useFuelCylinders,
		useGasLedger,
		useMealPlans,
		useMealServices
	} from '$lib/features/kitchen';
	import { useRecipes } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';
	import { addQty, qtyGt, subQty } from '$lib/utils/qty';
	import { SvelteSet } from 'svelte/reactivity';

	export interface GasAllocationRow {
		cylinder_id: string;
		hours: string;
		isManuallyEdited?: boolean;
	}

	let {
		gasRows = $bindable<GasAllocationRow[]>([]),
		selectedRecipeId = '',
		allocatedTarget = 0,
		currentPlanId = null
	}: {
		gasRows?: GasAllocationRow[];
		selectedRecipeId?: string;
		allocatedTarget?: number;
		currentPlanId?: string | null;
	} = $props();

	const gasTypes = useFuelCylinders();
	const gasLedger = useGasLedger();
	const recipes = useRecipes(() => getShelterCode());
	const mealPlans = useMealPlans();
	const mealServices = useMealServices();

	// Cylinders another batch is already cooking with right now (confirmed plan,
	// cooking started, no yield recorded yet) — must not be pickable here too,
	// so two batches never draw from the same physical tank at once.
	const cylinderIdsInUseByOthers = $derived.by(() => {
		const activePlans = (mealPlans.data ?? []).filter(
			(plan) =>
				plan._id !== currentPlanId &&
				plan.status === 'confirmed' &&
				!!plan.cooking_started_at &&
				!(mealServices.data ?? []).some((service) => service.meal_plan_id === plan._id)
		);
		const ids = new SvelteSet<string>();
		for (const plan of activePlans) {
			for (const usage of plan.gas_usage ?? []) {
				ids.add(usage.cylinder_id);
			}
		}
		return ids;
	});

	const analysis = $derived.by(() =>
		gasRows.map((row) => {
			const cylinder = (gasTypes.data ?? []).find((item) => item._id === row.cylinder_id);
			const recipe = (recipes.data ?? []).find((item) => item._id === selectedRecipeId);
			const rawStandardPortions = Number(recipe?.standard_portions) || 0;
			const standardPortions = rawStandardPortions > 1 ? rawStandardPortions : 50;
			const standardHours = Number(recipe?.standard_duration_hours) || 1;
			const expectedHours =
				Number(allocatedTarget) > 0
					? Math.max(
							0.1,
							Math.round(((Number(allocatedTarget) * standardHours) / standardPortions) * 10) / 10
						)
					: 0;
			const enteredHours = Number(row.hours) || 0;
			const hours =
				expectedHours > 0 && enteredHours > expectedHours * 2 ? expectedHours : enteredHours;
			const consumptionKg = cylinder ? calculateGasConsumptionKg(hours, cylinder) : '0';
			const remainingKg = cylinder
				? gasCylinderBalance(gasLedger.data ?? [], cylinder._id, cylinder.capacity_kg)
				: '0';
			return {
				row,
				cylinder,
				consumptionKg,
				remainingKg,
				isInsufficient: cylinder ? qtyGt(consumptionKg, remainingKg) : false
			};
		})
	);
	const recipeExpectedHours = $derived.by(() => {
		const recipe = (recipes.data ?? []).find((item) => item._id === selectedRecipeId);
		const portions = Number(allocatedTarget) || 0;
		const rawStandardPortions = Number(recipe?.standard_portions) || 0;
		const standardPortions = rawStandardPortions > 1 ? rawStandardPortions : 50;
		const standardHours = Number(recipe?.standard_duration_hours) || 0;
		if (portions <= 0) return null;
		if (standardPortions <= 0 || standardHours <= 0) {
			return Math.max(0.1, Math.round((portions / 50) * 10) / 10);
		}
		return Math.max(0.1, Math.round(((portions * standardHours) / standardPortions) * 10) / 10);
	});

	// Repair legacy plans that accidentally stored the portion count as hours
	// (233 h => 116.5 kg). The recipe rate is authoritative before cooking starts.
	$effect(() => {
		const expected = recipeExpectedHours;
		const first = gasRows[0];
		if (!expected || !first || Number(first.hours) <= expected * 2) return;
		first.hours = expected.toFixed(1);
		first.isManuallyEdited = false;
		gasRows = [...gasRows];
	});
	const totalAllocated = $derived(
		analysis.reduce((total, item) => addQty(total, item.consumptionKg), '0')
	);
	const recipeTotal = $derived.by(() => {
		const cylinder = analysis[0]?.cylinder;
		return cylinder && recipeExpectedHours
			? calculateGasConsumptionKg(recipeExpectedHours, cylinder)
			: '0';
	});
	const totalRequired = $derived(qtyGt(recipeTotal, 0) ? recipeTotal : totalAllocated);
	const stockShortfall = $derived(
		analysis.reduce(
			(total, item) =>
				qtyGt(item.consumptionKg, item.remainingKg)
					? addQty(total, subQty(item.consumptionKg, item.remainingKg))
					: total,
			'0'
		)
	);
	const allocationShortfall = $derived(
		qtyGt(totalRequired, totalAllocated) ? subQty(totalRequired, totalAllocated) : '0'
	);
	const totalShortfall = $derived(addQty(allocationShortfall, stockShortfall));
	const hasCylinderConflict = $derived.by(() =>
		gasRows.some((row) => {
			if (!row.cylinder_id) return false;
			if (cylinderIdsInUseByOthers.has(row.cylinder_id)) return true;
			const cylinder = (gasTypes.data ?? []).find((c) => c._id === row.cylinder_id);
			return !!cylinder?.deactivated;
		})
	);

	function addRow() {
		const unused = (gasTypes.data ?? []).find(
			(cylinder) => !gasRows.some((row) => row.cylinder_id === cylinder._id)
		);
		if (unused) gasRows = [...gasRows, { cylinder_id: unused._id, hours: '1.5' }];
	}

	function removeRow(index: number) {
		gasRows = gasRows.filter((_, rowIndex) => rowIndex !== index);
	}
</script>

<Card.Root class="border-orange-200 shadow-sm">
	<Card.Header class="pb-3">
		<Card.Title class="flex items-center gap-2 text-sm font-bold"
			><Flame class="h-4 w-4 text-orange-600" />จัดสรรเตาและแก๊ส (Stove & LPG)</Card.Title
		>
		<Card.Description class="text-xs"
			>กำหนดถังแก๊สและชั่วโมงปรุง หลังคลังจ่ายวัตถุดิบแล้ว · แสดงยอดที่ต้องใช้เพื่อวางแผนเท่านั้น</Card.Description
		>
	</Card.Header>
	<Card.Content class="space-y-3 text-xs">
		{#each gasRows as row, index (index)}
			{@const item = analysis[index]}
			<div class="space-y-2 rounded-lg border bg-card/60 p-3">
				<div class="flex items-center justify-between">
					<span class="font-semibold">เตา / ถังแก๊สที่ {index + 1}</span>{#if index > 0}<Button
							variant="ghost"
							size="icon"
							class="h-7 w-7 text-muted-foreground hover:text-rose-600"
							onclick={() => removeRow(index)}
							aria-label="ลบถังแก๊ส"><Trash2 class="h-3.5 w-3.5" /></Button
						>{/if}
				</div>
				<div class="grid gap-2 sm:grid-cols-2">
					<div>
						<Label class="text-2xs text-muted-foreground">เลือกถังแก๊ส</Label><select
							bind:value={row.cylinder_id}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
							><option value="" disabled>-- เลือกถังแก๊ส --</option
							>{#each gasTypes.data ?? [] as cylinder (cylinder._id)}{@const inUseByOther =
									cylinderIdsInUseByOthers.has(cylinder._id)}{@const unavailable =
									!!cylinder.deactivated}<option
									value={cylinder._id}
									disabled={inUseByOther || unavailable}
									>{cylinder.name} ({gasCylinderBalance(
										gasLedger.data ?? [],
										cylinder._id,
										cylinder.capacity_kg
									)}/{cylinder.capacity_kg} กก.){unavailable
										? ' — ใช้ไม่ได้'
										: inUseByOther
											? ' — กำลังใช้งานอยู่'
											: ''}</option
								>{/each}</select
						>
					</div>
					<div>
						<Label class="text-2xs text-muted-foreground">ชั่วโมงใช้งาน</Label><Input
							type="number"
							min="0.1"
							step="0.1"
							bind:value={row.hours}
							oninput={() => {
								row.isManuallyEdited = true;
								gasRows = [...gasRows];
							}}
							class="mt-1 h-9 text-xs"
						/>
					</div>
				</div>
				{#if item?.cylinder}
					<div
						class="flex items-center justify-between rounded-md bg-muted/30 px-2.5 py-2 text-2xs"
					>
						<span>ต้องใช้ประมาณ <strong>{item.consumptionKg} กก.</strong></span><span
							>คงเหลือหลังหักแผน <strong
								class={item.isInsufficient ? 'text-rose-600' : 'text-emerald-600'}
								>{item.remainingKg} กก.</strong
							></span
						>
					</div>
					{#if item.isInsufficient}<div
							class="flex items-center gap-1.5 rounded-md bg-rose-50 px-2.5 py-2 text-rose-700"
						>
							<AlertTriangle class="h-3.5 w-3.5" />แก๊สในถังไม่พอสำหรับชั่วโมงที่ระบุ
						</div>{/if}
				{/if}
			</div>
		{/each}
		{#if (gasTypes.data ?? []).length > gasRows.length}<Button
				type="button"
				variant="outline"
				size="sm"
				class="w-full gap-1.5 border-dashed text-xs"
				onclick={addRow}><Plus class="h-3.5 w-3.5" />เพิ่มเตา / ถังแก๊ส</Button
			>{/if}
		<div class="space-y-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
			<div class="flex items-center justify-between gap-3">
				<span class="font-semibold text-orange-900">แก๊สที่ต้องใช้ทั้งหมด:</span>
				<strong class="text-base font-bold text-orange-900 tabular-nums">{totalRequired} กก.</strong
				>
			</div>
			<div class="flex items-center justify-between gap-3 text-orange-800">
				<span>จัดสรรจากถังแล้ว:</span>
				<strong class="tabular-nums">{totalAllocated} กก.</strong>
			</div>
			{#if hasCylinderConflict}
				<div
					class="flex items-center gap-1.5 rounded-md bg-rose-100 px-2.5 py-2 font-semibold text-rose-800"
				>
					<AlertTriangle class="h-3.5 w-3.5" />
					ถังแก๊สที่เลือกใช้ไม่ได้หรือถูกใช้งานอยู่ กรุณาเลือกถังอื่น
				</div>
			{:else if qtyGt(totalShortfall, 0)}
				<div
					class="flex items-center justify-between gap-3 rounded-md bg-rose-100 px-2.5 py-2 font-semibold text-rose-800"
				>
					<span>ขาดอีก:</span>
					<strong class="tabular-nums">{totalShortfall} กก.</strong>
				</div>
			{:else}
				<div class="rounded-md bg-emerald-100 px-2.5 py-2 font-semibold text-emerald-800">
					แก๊สเพียงพอสำหรับการปรุงตามแผน
				</div>
			{/if}
		</div>
	</Card.Content>
</Card.Root>

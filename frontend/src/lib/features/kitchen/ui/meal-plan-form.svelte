<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SHELTER_CODE } from '$lib/db/shelter';
	import {
		useCreateMealPlanCalc,
		calculateMealIngredients,
		MEAL_PERIOD_LABELS,
		type MealPeriod,
		type MealPlanHeadcount
	} from '$lib/features/kitchen';
	import { useActiveSopProfile } from '$lib/features/sop-ratios';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let date = $state(new Date().toISOString().slice(0, 10));
	let meal = $state<MealPeriod>('lunch');
	let total = $state(0);
	let halal = $state(0);
	let softFood = $state(0);
	let infant = $state(0);

	const sopProfile = useActiveSopProfile();
	const createCalc = useCreateMealPlanCalc();

	const headcount = $derived<MealPlanHeadcount>({
		total,
		halal,
		soft_food: softFood,
		infant
	});

	// Sub-counts cannot exceed total (mirrors the domain invariant).
	const subCountsValid = $derived(halal + softFood + infant <= total);

	const preview = $derived.by(() => {
		if (!sopProfile.data || total <= 0) return null;
		const riceG = sopProfile.data.ratios.rice_g_per_person_meal;
		if (!riceG) return null;
		try {
			return calculateMealIngredients(
				headcount,
				riceG,
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
		const ctx = { shelterCode: SHELTER_CODE, createdBy: authStore.user?.name ?? 'staff' };
		try {
			await createCalc.mutateAsync({ date, meal, headcount, ctx });
			toast.success(`สร้างแผน ${MEAL_PERIOD_LABELS[meal]} วันที่ ${date} แล้ว`);
			open = false;
			total = 0;
			halal = 0;
			softFood = 0;
			infant = 0;
		} catch (err) {
			if ((err as { status?: number })?.status === 409) {
				toast.error(`มีแผน ${MEAL_PERIOD_LABELS[meal]} ของวันที่ ${date} อยู่แล้ว`);
			} else {
				toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
			}
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>สร้างแผนอาหาร</Dialog.Title>
			<Dialog.Description>กรอกข้อมูลเพื่อคำนวณรายการวัตถุดิบอัตโนมัติ</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<Label for="mp-date">วันที่</Label>
					<Input id="mp-date" type="date" bind:value={date} required />
				</div>
				<div class="space-y-1.5">
					<Label for="mp-meal">มื้ออาหาร</Label>
					<select
						id="mp-meal"
						bind:value={meal}
						class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none"
					>
						{#each Object.entries(MEAL_PERIOD_LABELS) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</div>
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
					ยอดฮาลาล + อาหารอ่อน + ทารก รวมกันต้องไม่เกินจำนวนทั้งหมด
				</p>
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
					<p class="text-sm font-semibold">
						ข้าว {preview.recipes[0]?.planned_qty.toLocaleString()} กรัม
						<span class="font-normal text-muted-foreground">
							({((preview.recipes[0]?.planned_qty ?? 0) / 1000).toFixed(2)} กก.)
						</span>
					</p>
					<p class="text-xs text-muted-foreground">
						SOP: {sopProfile.data.name} v{sopProfile.data.version}
						· {sopProfile.data.ratios.rice_g_per_person_meal} ก./คน/มื้อ
					</p>
				</div>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
				<Button
					type="submit"
					disabled={createCalc.isPending || total <= 0 || !sopProfile.data || !subCountsValid}
				>
					{createCalc.isPending ? 'กำลังบันทึก...' : 'สร้างแผน (draft)'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

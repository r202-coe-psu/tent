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
	import {
		useCreateMealPlanCalc,
		useOccupancyHeadcount,
		calculateMealIngredients,
		DEFAULT_RICE_G_PER_PERSON_MEAL,
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
	let overrideReason = $state('');

	const sopProfile = useActiveSopProfile();
	const occupancy = useOccupancyHeadcount();
	const createCalc = useCreateMealPlanCalc();

	// Auto-fill headcount from live occupancy once per open (T-06 source). After
	// that the fields are the user's to edit; the "ใช้ยอดล่าสุด" button re-syncs.
	let applied = $state(false);

	function fillFromOccupancy(h: MealPlanHeadcount) {
		total = h.total;
		halal = h.halal;
		softFood = h.soft_food;
		infant = h.infant;
	}

	$effect(() => {
		if (!open) {
			applied = false;
			return;
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

	const preview = $derived.by(() => {
		if (!sopProfile.data || total <= 0) return null;
		try {
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
		try {
			await createCalc.mutateAsync({
				date,
				meal,
				headcount,
				override_reason: isOverridden ? overrideReason.trim() : null,
				ctx
			});
			toast.success(`สร้างแผน ${MEAL_PERIOD_LABELS[meal]} วันที่ ${date} แล้ว`);
			open = false;
			overrideReason = '';
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
			<Dialog.Description
				>คำนวณรายการวัตถุดิบอัตโนมัติจากยอดผู้พักพิงจริง × SOP ratio</Dialog.Description
			>
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
					<p class="text-sm font-semibold">
						ข้าว {preview.recipes[0]?.planned_qty.toLocaleString()} กรัม
						<span class="font-normal text-muted-foreground">
							({((preview.recipes[0]?.planned_qty ?? 0) / 1000).toFixed(2)} กก.)
						</span>
					</p>
					<p class="text-xs text-muted-foreground">
						SOP: {sopProfile.data.name} v{sopProfile.data.version}
						· ข้าว {DEFAULT_RICE_G_PER_PERSON_MEAL} ก./คน/มื้อ (ค่าครัว)
					</p>
				</div>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
				<Button
					type="submit"
					disabled={createCalc.isPending ||
						total <= 0 ||
						!sopProfile.data ||
						!subCountsValid ||
						!overrideReasonValid}
				>
					{createCalc.isPending ? 'กำลังบันทึก...' : 'สร้างแผน (draft)'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

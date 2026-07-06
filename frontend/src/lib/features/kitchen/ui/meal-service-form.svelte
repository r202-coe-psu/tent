<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useRecordMealService,
		MEAL_PERIOD_LABELS,
		SHELTER_CODE,
		type MealPlan
	} from '$lib/features/kitchen';

	let { open = $bindable(false), plan = null }: { open?: boolean; plan?: MealPlan | null } =
		$props();

	const record = useRecordMealService();

	// Actuals — the kitchen fills these in after service. Defaults to 0 so an
	// unedited field is an explicit "none", not a missing value.
	let served = $state(0);
	let waste = $state(0);
	let volunteers = $state(0);
	let outsideEvacuees = $state(0);
	let notes = $state('');

	// Reset the actuals whenever a fresh plan opens the dialog — no carryover
	// between plans. Keyed on plan._id so reopening the same plan also resets.
	let seededFor = $state<string | null>(null);
	$effect(() => {
		if (open && plan && seededFor !== plan._id) {
			served = 0;
			waste = 0;
			volunteers = 0;
			outsideEvacuees = 0;
			notes = '';
			seededFor = plan._id;
		}
		if (!open) seededFor = null;
	});

	const planned = $derived(plan?.headcount.total ?? 0);
	const canSubmit = $derived(served >= 0 && waste >= 0 && volunteers >= 0 && outsideEvacuees >= 0);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!plan) return;
		const ctx = { shelterCode: SHELTER_CODE, createdBy: authStore.user?.name ?? 'staff' };
		try {
			await record.mutateAsync({
				input: {
					date: plan.date,
					meal: plan.meal,
					served,
					waste,
					external: { volunteers, outside_evacuees: outsideEvacuees },
					notes: notes.trim() || undefined
				},
				ctx
			});
			toast.success(`บันทึกบริการ ${MEAL_PERIOD_LABELS[plan.meal]} วันที่ ${plan.date} แล้ว`);
			open = false;
		} catch (err) {
			// meal_service is append-only with a deterministic _id — a re-record of the
			// same date+meal collides (409). Surface it as "already recorded" rather
			// than a raw conflict.
			if ((err as { status?: number })?.status === 409) {
				toast.error(`บันทึกบริการของ ${MEAL_PERIOD_LABELS[plan.meal]} วันที่ ${plan.date} ไว้แล้ว`);
			} else {
				toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
			}
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>บันทึกผลบริการอาหาร</Dialog.Title>
			<Dialog.Description class="break-words">
				{#if plan}
					แผน {MEAL_PERIOD_LABELS[plan.meal]} วันที่ {plan.date} — วางแผนไว้ {planned.toLocaleString()}
					คน
				{:else}
					เลือกแผนอาหารเพื่อบันทึกผลบริการ
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<Label for="ms-served">เสิร์ฟในศูนย์ (คน/กล่อง)</Label>
					<Input id="ms-served" type="number" min="0" bind:value={served} required />
				</div>
				<div class="space-y-1.5">
					<Label for="ms-waste">เหลือทิ้ง (กล่อง)</Label>
					<Input id="ms-waste" type="number" min="0" bind:value={waste} required />
				</div>
			</div>

			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">แจกจ่ายนอกศูนย์ (external support)</p>
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<Label for="ms-vol" class="text-xs">อาสาสมัคร</Label>
						<Input id="ms-vol" type="number" min="0" bind:value={volunteers} />
					</div>
					<div class="space-y-1.5">
						<Label for="ms-outside" class="text-xs">ผู้อพยพนอกศูนย์</Label>
						<Input id="ms-outside" type="number" min="0" bind:value={outsideEvacuees} />
					</div>
				</div>
			</div>

			<div class="space-y-1.5">
				<Label for="ms-notes" class="text-xs">หมายเหตุ (ไม่บังคับ)</Label>
				<textarea
					id="ms-notes"
					bind:value={notes}
					rows="2"
					placeholder="เช่น เสิร์ฟช้ากว่ากำหนด / มีอาสาช่วยแจก"
					class="flex w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none"
				></textarea>
			</div>

			<!-- Quick plan-vs-actual preview so the user sees the variance before saving -->
			{#if plan && planned > 0}
				<div class="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs">
					<ClipboardCheck class="h-4 w-4 shrink-0 text-muted-foreground" />
					<span>
						วางแผน {planned.toLocaleString()} · เสิร์ฟ {served.toLocaleString()} ·
						<span
							class="font-semibold {served - planned < 0 ? 'text-amber-700' : 'text-emerald-700'}"
						>
							ผลต่าง {served - planned >= 0 ? '+' : ''}{(served - planned).toLocaleString()}
						</span>
					</span>
				</div>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
				<Button type="submit" disabled={record.isPending || !plan || !canSubmit}>
					{record.isPending ? 'กำลังบันทึก...' : 'บันทึกผลบริการ'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

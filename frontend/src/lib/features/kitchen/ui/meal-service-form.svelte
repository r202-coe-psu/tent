<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useRecordMealService, MEAL_PERIOD_LABELS, type MealPlan } from '$lib/features/kitchen';

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

	const planned = $derived(plan?.headcount.total ?? 0);
	const canSubmit = $derived(served >= 0 && waste >= 0 && volunteers >= 0 && outsideEvacuees >= 0);

	// Soft warnings only — over-planned service is a real, expected scenario
	// (computeMealVariance's `over` status covers it, e.g. the plan
	// under-estimated demand), so these flag the numbers for a second look
	// instead of blocking the record. Checked both per-field and combined,
	// since a set of individually-fine numbers can still add up past plan.
	const servedExceeds = $derived(planned > 0 && served > planned);
	const wasteExceeds = $derived(planned > 0 && waste > planned);
	const volunteersExceeds = $derived(planned > 0 && volunteers > planned);
	const outsideExceeds = $derived(planned > 0 && outsideEvacuees > planned);
	const total = $derived(served + waste + volunteers + outsideEvacuees);
	const totalExceeds = $derived(planned > 0 && total > planned);

	// Discard the actuals on close — no carryover between plans (mirrors
	// requisition-dialog's close() pattern instead of resetting via $effect).
	function resetActuals() {
		served = 0;
		waste = 0;
		volunteers = 0;
		outsideEvacuees = 0;
		notes = '';
	}

	function close() {
		resetActuals();
		open = false;
	}

	// Covers escape/overlay close in addition to the cancel button's close().
	function handleOpenChange(v: boolean) {
		open = v;
		if (!v) resetActuals();
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!plan) return;
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		try {
			await record.mutateAsync({
				input: {
					date: plan.date,
					meal: plan.meal,
					meal_plan_id: plan._id,
					served,
					waste,
					external: { volunteers, outside_evacuees: outsideEvacuees },
					notes: notes.trim() || undefined
				},
				ctx
			});
			toast.success(`บันทึกบริการ ${MEAL_PERIOD_LABELS[plan.meal]} วันที่ ${plan.date} แล้ว`);
			close();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-lg">
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
					{#if servedExceeds}
						<p class="text-xs text-amber-600">
							⚠ เกินยอดที่วางแผนไว้ ({planned.toLocaleString()} คน) — ตรวจสอบยอดก่อนบันทึก
						</p>
					{/if}
				</div>
				<div class="space-y-1.5">
					<Label for="ms-waste">เหลือทิ้ง (กล่อง)</Label>
					<Input id="ms-waste" type="number" min="0" bind:value={waste} required />
					{#if wasteExceeds}
						<p class="text-xs text-amber-600">
							⚠ เกินยอดที่วางแผนไว้ ({planned.toLocaleString()}) — ตรวจสอบยอดก่อนบันทึก
						</p>
					{/if}
				</div>
			</div>

			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">แจกจ่ายนอกศูนย์ (external support)</p>
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<Label for="ms-vol" class="text-xs">อาสาสมัคร</Label>
						<Input id="ms-vol" type="number" min="0" bind:value={volunteers} />
						{#if volunteersExceeds}
							<p class="text-xs text-amber-600">
								⚠ เกินยอดที่วางแผนไว้ ({planned.toLocaleString()})
							</p>
						{/if}
					</div>
					<div class="space-y-1.5">
						<Label for="ms-outside" class="text-xs">ผู้อพยพนอกศูนย์</Label>
						<Input id="ms-outside" type="number" min="0" bind:value={outsideEvacuees} />
						{#if outsideExceeds}
							<p class="text-xs text-amber-600">
								⚠ เกินยอดที่วางแผนไว้ ({planned.toLocaleString()})
							</p>
						{/if}
					</div>
				</div>
			</div>

			{#if totalExceeds}
				<p class="text-xs text-amber-600">
					⚠ รวมทุกช่อง ({total.toLocaleString()}) เกินยอดที่วางแผนไว้ ({planned.toLocaleString()}
					คน) — ตรวจสอบยอดก่อนบันทึก
				</p>
			{/if}

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
				<Button type="button" variant="outline" onclick={close}>ยกเลิก</Button>
				<Button type="submit" disabled={record.isPending || !plan || !canSubmit}>
					{record.isPending ? 'กำลังบันทึก...' : 'บันทึกผลบริการ'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

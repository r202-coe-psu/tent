<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useRecordMealService,
		mealServiceInputSchema,
		MEAL_PERIOD_LABELS,
		type MealPlan
	} from '$lib/features/kitchen';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';

	let { open = $bindable(false), plan = null }: { open?: boolean; plan?: MealPlan | null } =
		$props();

	const record = useRecordMealService();

	const form = superForm(
		defaults(
			{
				date: new Date().toISOString().slice(0, 10),
				meal: 'lunch',
				meal_plan_id: null,
				meal_session_id: null,
				actual_yield: null,
				served: 0,
				waste: 0,
				external: { volunteers: 0, outside_evacuees: 0 },
				notes: ''
			},
			zod4(mealServiceInputSchema)
		),
		{
			SPA: true,
			validators: zod4(mealServiceInputSchema),
			dataType: 'json',
			resetForm: true,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid || !plan) return;
				const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
				try {
					await record.mutateAsync({
						input: {
							date: plan.date,
							meal: plan.meal,
							meal_plan_id: plan._id,
							...(plan.meal_session_id !== undefined
								? { meal_session_id: plan.meal_session_id }
								: {}),
							actual_yield: validated.data.actual_yield ?? undefined,
							served: validated.data.served,
							waste: validated.data.waste,
							external: {
								volunteers: validated.data.external.volunteers,
								outside_evacuees: validated.data.external.outside_evacuees
							},
							notes: validated.data.notes?.trim() || undefined
						},
						ctx
					});
					toast.success(`บันทึกบริการ ${MEAL_PERIOD_LABELS[plan.meal]} วันที่ ${plan.date} แล้ว`);
					close();
				} catch (err) {
					toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
				}
			}
		}
	);

	const { form: formData, enhance, submitting, reset } = form;

	$effect(() => {
		if (open && plan) {
			$formData.date = plan.date;
			$formData.meal = plan.meal;
			$formData.meal_plan_id = plan._id;
			$formData.meal_session_id = plan.meal_session_id ?? null;
		}
	});

	function close() {
		reset();
		open = false;
	}

	// Handles dialog open/close change and resets form on dismiss.
	function handleOpenChange(v: boolean) {
		open = v;
		if (!v) reset();
	}

	const planned = $derived(plan?.headcount.total ?? 0);

	// Warns when served count exceeds actual yield.
	const servedExceedsYield = $derived(
		$formData.actual_yield != null && $formData.served > $formData.actual_yield
	);

	// Soft warnings when distribution values exceed planned headcount.
	const servedExceeds = $derived(planned > 0 && $formData.served > planned);
	const wasteExceeds = $derived(planned > 0 && $formData.waste > planned);
	const volunteersExceeds = $derived(planned > 0 && $formData.external.volunteers > planned);
	const outsideExceeds = $derived(planned > 0 && $formData.external.outside_evacuees > planned);
	const total = $derived(
		$formData.served +
			$formData.waste +
			$formData.external.volunteers +
			$formData.external.outside_evacuees
	);
	const totalExceeds = $derived(planned > 0 && total > planned);
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

		<form method="POST" use:enhance class="space-y-4">
			<Form.Field {form} name="actual_yield" class="space-y-1.5">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ผลผลิตที่ทำได้จริง (Actual Yield) — เพดานการแจก (ไม่บังคับ)</Form.Label>
						<Input {...props} type="number" min="0" bind:value={$formData.actual_yield} />
					{/snippet}
				</Form.Control>
				<p class="text-xs text-muted-foreground">
					จำนวนที่ปรุงเสร็จจริง — ปล่อยว่างได้ถ้ายังไม่ทราบ
				</p>
				<Form.FieldErrors />
				{#if servedExceedsYield}
					<p class="text-xs text-amber-600">
						⚠ เสิร์ฟมากกว่าผลผลิตที่ทำได้จริง — ตรวจสอบยอดก่อนบันทึก
					</p>
				{/if}
			</Form.Field>

			<div class="grid grid-cols-2 gap-4">
				<Form.Field {form} name="served" class="space-y-1.5">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>เสิร์ฟในศูนย์ (คน/กล่อง)</Form.Label>
							<Input {...props} type="number" min="0" bind:value={$formData.served} required />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
					{#if servedExceeds}
						<p class="text-xs text-amber-600">
							⚠ เกินยอดที่วางแผนไว้ ({planned.toLocaleString()} คน) — ตรวจสอบยอดก่อนบันทึก
						</p>
					{/if}
				</Form.Field>

				<Form.Field {form} name="waste" class="space-y-1.5">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>เหลือทิ้ง (กล่อง)</Form.Label>
							<Input {...props} type="number" min="0" bind:value={$formData.waste} required />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
					{#if wasteExceeds}
						<p class="text-xs text-amber-600">
							⚠ เกินยอดที่วางแผนไว้ ({planned.toLocaleString()}) — ตรวจสอบยอดก่อนบันทึก
						</p>
					{/if}
				</Form.Field>
			</div>

			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">แจกจ่ายนอกศูนย์ (external support)</p>
				<div class="grid grid-cols-2 gap-4">
					<Form.Field {form} name="external.volunteers" class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-xs">อาสาสมัคร</Form.Label>
								<Input
									{...props}
									type="number"
									min="0"
									bind:value={$formData.external.volunteers}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
						{#if volunteersExceeds}
							<p class="text-xs text-amber-600">
								⚠ เกินยอดที่วางแผนไว้ ({planned.toLocaleString()})
							</p>
						{/if}
					</Form.Field>

					<Form.Field {form} name="external.outside_evacuees" class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-xs">ผู้อพยพนอกศูนย์</Form.Label>
								<Input
									{...props}
									type="number"
									min="0"
									bind:value={$formData.external.outside_evacuees}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
						{#if outsideExceeds}
							<p class="text-xs text-amber-600">
								⚠ เกินยอดที่วางแผนไว้ ({planned.toLocaleString()})
							</p>
						{/if}
					</Form.Field>
				</div>
			</div>

			{#if totalExceeds}
				<p class="text-xs text-amber-600">
					⚠ รวมทุกช่อง ({total.toLocaleString()}) เกินยอดที่วางแผนไว้ ({planned.toLocaleString()}
					คน) — ตรวจสอบยอดก่อนบันทึก
				</p>
			{/if}

			<Form.Field {form} name="notes" class="space-y-1.5">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="text-xs">หมายเหตุ (ไม่บังคับ)</Form.Label>
						<textarea
							{...props}
							bind:value={$formData.notes}
							rows="2"
							placeholder="เช่น เสิร์ฟช้ากว่ากำหนด / มีอาสาช่วยแจก"
							class="flex w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none"
						></textarea>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<!-- Quick plan-vs-actual preview so the user sees the variance before saving -->
			{#if plan && planned > 0}
				<div class="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs">
					<ClipboardCheck class="h-4 w-4 shrink-0 text-muted-foreground" />
					<span>
						วางแผน {planned.toLocaleString()} · เสิร์ฟ {$formData.served.toLocaleString()}
						{#if $formData.actual_yield !== null && $formData.actual_yield !== undefined}
							· ทำได้จริง {$formData.actual_yield.toLocaleString()}
						{/if}
						·
						<span
							class="font-semibold {$formData.served - planned === 0
								? 'text-emerald-700'
								: 'text-amber-700'}"
						>
							ผลต่าง {$formData.served - planned >= 0 ? '+' : ''}{(
								$formData.served - planned
							).toLocaleString()}
						</span>
					</span>
				</div>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={close}>ยกเลิก</Button>
				<Button type="submit" disabled={$submitting || record.isPending || !plan}>
					{$submitting || record.isPending ? 'กำลังบันทึก...' : 'บันทึกผลบริการ'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

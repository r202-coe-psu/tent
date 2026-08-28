<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		type ReplenishmentPolicy,
		type ReplenishmentScope
	} from '../domain/replenishment-policy';
	import { resolveSource, type Source } from '$lib/utils/source';
	import { useSaveReplenishmentPolicy } from '../application/replenishment-queries';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import { toast } from 'svelte-sonner';

	let {
		policy = null,
		isEdit = false,
		shelterCode = '',
		onsuccess,
		oncancel
	}: {
		policy?: ReplenishmentPolicy | null;
		isEdit?: boolean;
		shelterCode?: string;
		onsuccess?: () => void;
		oncancel?: () => void;
	} = $props();

	const reqGroupsQuery = useRequirementGroups(() => shelterCode);
	const saveMutation = useSaveReplenishmentPolicy();

	const groups = $derived(reqGroupsQuery.data ?? []);

	let formScope = $state<ReplenishmentScope>('REQUIREMENT_GROUP');
	let formTargetId = $state('');
	let formLeadTime = $state<number | string>(2);
	let formReviewPeriod = $state<number | string>(3);
	let formSafetyDays = $state<number | string>(2);
	let formMinDoc = $state<number | string>(2);
	let formMaxDoc = $state<number | string>(30);
	let formErrors = $state<Record<string, string>>({});

	const selectedGroup = $derived(
		groups.find(
			(g) =>
				g._id === `requirement_group:${formTargetId}` ||
				g._id === formTargetId ||
				g.name === formTargetId
		)
	);

	// Reactive calculation of Standard Reorder Days (FR-REPLEN-02, Invariant 3, TC-E2E-06)
	const standardReorderDays = $derived(
		(Number(formLeadTime) || 0) + (Number(formReviewPeriod) || 0) + (Number(formSafetyDays) || 0)
	);

	$effect(() => {
		if (policy) {
			formScope = policy.scope_type;
			formTargetId = policy.target_id;
			formLeadTime = policy.lead_time_days;
			formReviewPeriod = policy.review_period_days;
			formSafetyDays = policy.safety_days;
			formMinDoc = policy.min_doc_days;
			formMaxDoc = policy.max_doc_days;
		} else {
			formScope = 'REQUIREMENT_GROUP';
			formTargetId = groups[0] ? groups[0]._id.replace(/^requirement_group:/, '') : '';
			formLeadTime = 2;
			formReviewPeriod = 3;
			formSafetyDays = 2;
			formMinDoc = 2;
			formMaxDoc = 30;
		}
		formErrors = {};
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		formErrors = {};

		const cleanTargetId = formTargetId
			.trim()
			.toUpperCase()
			.replace(/^REQUIREMENT_GROUP:/, '');
		if (!cleanTargetId) {
			formErrors.targetId = 'กรุณาเลือกกลุ่มสำหรับการคำนวณ';
		}

		const lead = Number(formLeadTime);
		const review = Number(formReviewPeriod);
		const safety = Number(formSafetyDays);
		const minDoc = Number(formMinDoc);
		const maxDoc = Number(formMaxDoc);

		if (isNaN(lead) || lead < 0) formErrors.leadTime = 'ระยะเวลารอคอยสินค้าต้องไม่ติดลบ';
		if (isNaN(review) || review < 0) formErrors.reviewPeriod = 'รอบการสั่งซื้อต้องไม่ติดลบ';
		if (isNaN(safety) || safety < 0) formErrors.safetyDays = 'วันสำรองเผื่อฉุกเฉินต้องไม่ติดลบ';
		if (isNaN(minDoc) || minDoc < 0) formErrors.minDoc = 'วันคงคลังขั้นต่ำต้องไม่ติดลบ';
		if (isNaN(maxDoc) || maxDoc < 0) formErrors.maxDoc = 'วันคงคลังสูงสุดต้องไม่ติดลบ';

		const reorderDays =
			(isNaN(lead) ? 0 : lead) + (isNaN(review) ? 0 : review) + (isNaN(safety) ? 0 : safety);

		// Invariant 9 & TC-E2E-07: Validation guard
		if (!isNaN(minDoc) && !isNaN(reorderDays) && minDoc >= reorderDays) {
			formErrors.minDoc =
				'วันคงคลังขั้นต่ำ (Min DoC) ต้องน้อยกว่าจำนวนวันสั่งเติมมาตรฐาน (ระยะเวลารอคอย + รอบสั่งซื้อ + วันสำรอง)';
		}

		if (!isNaN(minDoc) && !isNaN(maxDoc) && minDoc >= maxDoc) {
			formErrors.maxDoc = 'วันคงคลังขั้นต่ำ (Min DoC) ต้องน้อยกว่าวันคงคลังสูงสุด (Max DoC)';
		}

		if (Object.keys(formErrors).length > 0) {
			return;
		}

		const computedSource: Source = resolveSource(shelterCode);
		const docId = `replenishment_policy:${formScope}:${cleanTargetId}`;
		try {
			await saveMutation.mutateAsync({
				id: docId,
				input: {
					scope_type: formScope,
					target_id: cleanTargetId,
					lead_time_days: lead,
					review_period_days: review,
					safety_days: safety,
					min_doc_days: minDoc,
					max_doc_days: maxDoc,
					source: computedSource,
					shelter_code: computedSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
				},
				shelterCode: computedSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
			toast.success(
				isEdit
					? `ปรับปรุงนโยบายการเติมสต็อก ${cleanTargetId} สำเร็จ`
					: `บันทึกนโยบายการเติมสต็อก ${cleanTargetId} สำเร็จ`
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
			<!-- Row 1: กลุ่มสำหรับการคำนวณ -->
			<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
				<Field.Field>
					<Field.Label for="form-replen-group">
						กลุ่มสำหรับการคำนวณ <span class="font-bold text-destructive">*</span>
					</Field.Label>
					{#if groups.length > 0}
						<Select.Root type="single" bind:value={formTargetId} disabled={isEdit}>
							<Select.Trigger
								id="form-replen-group"
								class="h-9 w-full rounded-md border-input bg-background font-mono"
							>
								{selectedGroup
									? `${selectedGroup.name} (${selectedGroup._id.replace(/^requirement_group:/, '')})`
									: formTargetId || 'เลือกกลุ่มสำหรับการคำนวณ'}
							</Select.Trigger>
							<Select.Content>
								{#each groups as g (g._id)}
									{@const cleanId = g._id.replace(/^requirement_group:/, '')}
									<Select.Item value={cleanId} label="{g.name} ({cleanId})" />
								{/each}
							</Select.Content>
						</Select.Root>
					{:else}
						<Input
							id="form-replen-group"
							aria-label="กลุ่มสำหรับการคำนวณ"
							bind:value={formTargetId}
							disabled={isEdit}
							placeholder="เช่น FOOD_ENERGY"
							class="font-mono uppercase"
						/>
					{/if}
					{#if formErrors.targetId}
						<Field.Error>{formErrors.targetId}</Field.Error>
					{/if}
				</Field.Field>
			</Field.FieldGroup>

			<!-- Row 2: Lead Time, Review Period, Safety Days -->
			<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-3">
				<Field.Field>
					<Field.Label for="form-lead-time">
						ระยะเวลารอคอยสินค้า (วัน) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-lead-time"
						aria-label="ระยะเวลารอคอยสินค้า (Lead Time)"
						type="number"
						min="0"
						bind:value={formLeadTime}
					/>
					{#if formErrors.leadTime}
						<Field.Error>{formErrors.leadTime}</Field.Error>
					{/if}
				</Field.Field>

				<Field.Field>
					<Field.Label for="form-review-period">
						รอบการสั่งซื้อ (วัน) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-review-period"
						aria-label="รอบการสั่งซื้อ (Review Period)"
						type="number"
						min="0"
						bind:value={formReviewPeriod}
					/>
					{#if formErrors.reviewPeriod}
						<Field.Error>{formErrors.reviewPeriod}</Field.Error>
					{/if}
				</Field.Field>

				<Field.Field>
					<Field.Label for="form-safety-days">
						วันสำรองเผื่อฉุกเฉิน (วัน) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-safety-days"
						aria-label="วันสำรองเผื่อฉุกเฉิน (Safety Days)"
						type="number"
						min="0"
						bind:value={formSafetyDays}
					/>
					{#if formErrors.safetyDays}
						<Field.Error>{formErrors.safetyDays}</Field.Error>
					{/if}
				</Field.Field>
			</Field.FieldGroup>

			<!-- Reactive Reorder Days Display -->
			<div
				class="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3.5"
			>
				<div>
					<div class="text-sm font-semibold text-foreground">จำนวนวันสั่งเติมมาตรฐาน</div>
					<div class="text-xs text-muted-foreground">ระยะเวลารอคอย + รอบสั่งซื้อ + วันสำรอง</div>
				</div>
				<div class="font-mono text-xl font-bold text-primary">
					<span data-testid="standard-reorder-days">{standardReorderDays}</span> วัน
				</div>
			</div>

			<!-- Row 3: Min DoC & Max DoC -->
			<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
				<Field.Field>
					<Field.Label for="form-min-doc">
						วันคงคลังขั้นต่ำ (วัน) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-min-doc"
						aria-label="วันคงคลังขั้นต่ำ (Min DoC)"
						type="number"
						min="0"
						bind:value={formMinDoc}
					/>
					{#if formErrors.minDoc}
						<Field.Error>{formErrors.minDoc}</Field.Error>
					{/if}
				</Field.Field>

				<Field.Field>
					<Field.Label for="form-max-doc">
						วันคงคลังสูงสุด (วัน) <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-max-doc"
						aria-label="วันคงคลังสูงสุด (Max DoC)"
						type="number"
						min="0"
						bind:value={formMaxDoc}
					/>
					{#if formErrors.maxDoc}
						<Field.Error>{formErrors.maxDoc}</Field.Error>
					{/if}
				</Field.Field>
			</Field.FieldGroup>
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

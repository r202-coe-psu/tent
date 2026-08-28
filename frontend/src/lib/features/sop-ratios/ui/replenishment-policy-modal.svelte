<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		type ReplenishmentPolicy,
		type ReplenishmentScope
	} from '../domain/replenishment-policy';
	import { resolveSource, type Source } from '$lib/utils/source';
	import { useSaveReplenishmentPolicy } from '../application/replenishment-queries';
	import { useRequirementGroups } from '../application/requirement-group-queries';

	let {
		open = $bindable(false),
		policy = null,
		shelterCode = '',
		onClose
	}: {
		open: boolean;
		policy: ReplenishmentPolicy | null;
		shelterCode?: string;
		onClose: () => void;
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

		open = false;
		onClose();
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="replen-modal-title"
	>
		<div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 shadow-xl">
			<h2 id="replen-modal-title" class="text-lg font-semibold">
				{policy ? 'แก้ไขนโยบายการเติมสต็อก' : 'สร้างนโยบายการเติมสต็อก'}
			</h2>

			<form onsubmit={handleSubmit} class="mt-4 space-y-4">
				<div>
					<label for="form-replen-group" class="block text-sm font-medium">
						กลุ่มสำหรับการคำนวณ <span class="text-destructive">*</span>
					</label>
					{#if groups.length > 0}
						<select
							id="form-replen-group"
							aria-label="กลุ่มสำหรับการคำนวณ"
							bind:value={formTargetId}
							disabled={!!policy}
							class="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
						>
							{#each groups as g (g._id)}
								{@const cleanId = g._id.replace(/^requirement_group:/, '')}
								<option value={cleanId}>{g.name} ({cleanId})</option>
							{/each}
							{#if policy && !groups.some((g) => g._id.replace(/^requirement_group:/, '') === formTargetId)}
								<option value={formTargetId}>{formTargetId}</option>
							{/if}
						</select>
					{:else}
						<Input
							id="form-replen-group"
							aria-label="กลุ่มสำหรับการคำนวณ"
							bind:value={formTargetId}
							disabled={!!policy}
							placeholder="เช่น FOOD_ENERGY"
							class="mt-1 font-mono uppercase"
						/>
					{/if}
					{#if formErrors.targetId}
						<p class="mt-1 text-xs text-destructive">{formErrors.targetId}</p>
					{/if}
				</div>

				<div class="grid grid-cols-3 gap-3">
					<div>
						<label for="form-lead-time" class="block text-xs font-medium">
							ระยะเวลารอคอยสินค้า (วัน) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-lead-time"
							aria-label="ระยะเวลารอคอยสินค้า (Lead Time)"
							type="number"
							min="0"
							bind:value={formLeadTime}
							class="mt-1 text-sm"
						/>
						{#if formErrors.leadTime}
							<p class="mt-1 text-[10px] text-destructive">{formErrors.leadTime}</p>
						{/if}
					</div>

					<div>
						<label for="form-review-period" class="block text-xs font-medium">
							รอบการสั่งซื้อ (วัน) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-review-period"
							aria-label="รอบการสั่งซื้อ (Review Period)"
							type="number"
							min="0"
							bind:value={formReviewPeriod}
							class="mt-1 text-sm"
						/>
						{#if formErrors.reviewPeriod}
							<p class="mt-1 text-[10px] text-destructive">{formErrors.reviewPeriod}</p>
						{/if}
					</div>

					<div>
						<label for="form-safety-days" class="block text-xs font-medium">
							วันสำรองเผื่อฉุกเฉิน (วัน) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-safety-days"
							aria-label="วันสำรองเผื่อฉุกเฉิน (Safety Days)"
							type="number"
							min="0"
							bind:value={formSafetyDays}
							class="mt-1 text-sm"
						/>
						{#if formErrors.safetyDays}
							<p class="mt-1 text-[10px] text-destructive">{formErrors.safetyDays}</p>
						{/if}
					</div>
				</div>

				<!-- Reactive Reorder Days Display (FR-REPLEN-02, Invariant 3, data-testid="standard-reorder-days") -->
				<div class="rounded-lg border border-primary/20 bg-primary/10 p-3 text-center">
					<div class="text-xs font-medium text-muted-foreground">
						จำนวนวันสั่งเติมมาตรฐาน (ระยะเวลารอคอย + รอบสั่งซื้อ + วันสำรอง):
					</div>
					<div class="mt-1 font-mono text-xl font-bold text-primary">
						<span data-testid="standard-reorder-days">{standardReorderDays}</span> วัน
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="form-min-doc" class="block text-xs font-medium">
							วันคงคลังขั้นต่ำ (Min DoC / จุดสั่งด่วน) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-min-doc"
							aria-label="วันคงคลังขั้นต่ำ (Min DoC)"
							type="number"
							min="0"
							bind:value={formMinDoc}
							class="mt-1 text-sm"
						/>
						{#if formErrors.minDoc}
							<p class="mt-1 text-xs text-destructive">{formErrors.minDoc}</p>
						{/if}
					</div>

					<div>
						<label for="form-max-doc" class="block text-xs font-medium">
							วันคงคลังสูงสุด (Max DoC / เพดานสต็อก) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-max-doc"
							aria-label="วันคงคลังสูงสุด (Max DoC)"
							type="number"
							min="0"
							bind:value={formMaxDoc}
							class="mt-1 text-sm"
						/>
						{#if formErrors.maxDoc}
							<p class="mt-1 text-xs text-destructive">{formErrors.maxDoc}</p>
						{/if}
					</div>
				</div>

				<div class="flex justify-end gap-2 border-t pt-4">
					<Button
						type="button"
						variant="outline"
						onclick={() => {
							open = false;
							onClose();
						}}
					>
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

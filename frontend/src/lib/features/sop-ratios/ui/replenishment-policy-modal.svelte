<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		replenishmentScopeSchema,
		REPLENISHMENT_SCOPE_LABELS,
		type ReplenishmentPolicy,
		type ReplenishmentScope
	} from '../domain/replenishment-policy';
	import { useSaveReplenishmentPolicy } from '../application/replenishment-queries';

	let {
		open = $bindable(false),
		policy = null,
		shelterCode = '',
		isSA = false,
		onClose
	}: {
		open: boolean;
		policy: ReplenishmentPolicy | null;
		shelterCode?: string;
		isSA?: boolean;
		onClose: () => void;
	} = $props();

	const saveMutation = useSaveReplenishmentPolicy();

	let formScope = $state<ReplenishmentScope>('GLOBAL');
	let formTargetId = $state('DEFAULT');
	let formLeadTime = $state<number | string>(2);
	let formReviewPeriod = $state<number | string>(3);
	let formSafetyDays = $state<number | string>(2);
	let formMinDoc = $state<number | string>(2);
	let formMaxDoc = $state<number | string>(30);
	let formSource = $state<'SPHERE_BASELINE' | 'SHELTER_OVERRIDE'>('SPHERE_BASELINE');
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
			formSource = policy.source;
		} else {
			formScope = 'GLOBAL';
			formTargetId = 'DEFAULT';
			formLeadTime = 2;
			formReviewPeriod = 3;
			formSafetyDays = 2;
			formMinDoc = 2;
			formMaxDoc = 30;
			formSource = shelterCode && !isSA ? 'SHELTER_OVERRIDE' : 'SPHERE_BASELINE';
		}
		formErrors = {};
	});

	function handleScopeChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		const newScope = target.value as ReplenishmentScope;
		formScope = newScope;
		if (newScope === 'GLOBAL' && (!policy || policy.scope_type !== 'GLOBAL')) {
			formTargetId = 'DEFAULT';
		} else if (formTargetId === 'DEFAULT' && newScope !== 'GLOBAL') {
			formTargetId = '';
		}
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		formErrors = {};

		const cleanTargetId = formTargetId.trim();
		if (!cleanTargetId) {
			formErrors.targetId = 'กรุณาระบุเป้าหมายของนโยบาย';
		}

		const lead = Number(formLeadTime);
		const review = Number(formReviewPeriod);
		const safety = Number(formSafetyDays);
		const minDoc = Number(formMinDoc);
		const maxDoc = Number(formMaxDoc);

		if (isNaN(lead) || lead < 0) formErrors.leadTime = 'Lead Time ต้องไม่ติดลบ';
		if (isNaN(review) || review < 0) formErrors.reviewPeriod = 'Review Period ต้องไม่ติดลบ';
		if (isNaN(safety) || safety < 0) formErrors.safetyDays = 'Safety Days ต้องไม่ติดลบ';
		if (isNaN(minDoc) || minDoc < 0) formErrors.minDoc = 'Min DoC ต้องไม่ติดลบ';
		if (isNaN(maxDoc) || maxDoc < 0) formErrors.maxDoc = 'Max DoC ต้องไม่ติดลบ';

		const reorderDays =
			(isNaN(lead) ? 0 : lead) + (isNaN(review) ? 0 : review) + (isNaN(safety) ? 0 : safety);

		// Invariant 9 & TC-E2E-07: Validation guard
		if (!isNaN(minDoc) && !isNaN(reorderDays) && minDoc >= reorderDays) {
			formErrors.minDoc =
				'Min DoC Days ต้องน้อยกว่า Standard Reorder Days (Lead Time + Review Period + Safety Days)';
		}

		if (!isNaN(minDoc) && !isNaN(maxDoc) && minDoc >= maxDoc) {
			formErrors.maxDoc = 'Min DoC Days ต้องน้อยกว่า Max DoC Days';
		}

		if (Object.keys(formErrors).length > 0) {
			return;
		}

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
				source: formSource,
				shelter_code: formSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			},
			shelterCode: formSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
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
				{policy ? 'แก้ไขนโยบายการเติมสต็อก' : 'สร้างนโยบายการเติมสต็อก (Replenishment Policy)'}
			</h2>

			<form onsubmit={handleSubmit} class="mt-4 space-y-4">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="form-replen-scope" class="block text-sm font-medium">
							ขอบเขต (Scope) <span class="text-destructive">*</span>
						</label>
						<select
							id="form-replen-scope"
							aria-label="Scope"
							bind:value={formScope}
							onchange={handleScopeChange}
							disabled={!!policy}
							class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
						>
							{#each replenishmentScopeSchema.options as scope (scope)}
								<option value={scope}>{REPLENISHMENT_SCOPE_LABELS[scope] ?? scope}</option>
							{/each}
						</select>
					</div>

					<div>
						<label for="form-replen-target" class="block text-sm font-medium">
							เป้าหมาย (Target ID) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-replen-target"
							aria-label="Target ID"
							bind:value={formTargetId}
							disabled={!!policy}
							placeholder={formScope === 'GLOBAL'
								? 'DEFAULT'
								: formScope === 'REQUIREMENT_GROUP'
									? 'FOOD_ENERGY'
									: 'item_master:...'}
							class="mt-1 font-mono"
						/>
						{#if formErrors.targetId}
							<p class="mt-1 text-xs text-destructive">{formErrors.targetId}</p>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-3 gap-3">
					<div>
						<label for="form-lead-time" class="block text-xs font-medium">
							Lead Time (วัน) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-lead-time"
							aria-label="Lead Time"
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
							Review Period (วัน) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-review-period"
							aria-label="Review Period"
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
							Safety Days (วัน) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-safety-days"
							aria-label="Safety Days"
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
						จำนวนวันสั่งเติมมาตรฐาน (Standard Reorder Days = Lead + Review + Safety):
					</div>
					<div class="mt-1 font-mono text-xl font-bold text-primary">
						<span data-testid="standard-reorder-days">{standardReorderDays}</span> วัน
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="form-min-doc" class="block text-xs font-medium">
							Min DoC (วันวิกฤตแจ้งเตือนสั่งด่วน) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-min-doc"
							aria-label="Min DoC"
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
							Max DoC (เพดานสต็อกเกินเกณฑ์) <span class="text-destructive">*</span>
						</label>
						<Input
							id="form-max-doc"
							aria-label="Max DoC"
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

				<div>
					<label for="form-replen-source" class="block text-sm font-medium">
						แหล่งที่มา (Source)
					</label>
					<select
						id="form-replen-source"
						bind:value={formSource}
						disabled={!isSA}
						class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
					>
						<option value="SPHERE_BASELINE">ส่วนกลาง (SPHERE_BASELINE)</option>
						<option value="SHELTER_OVERRIDE">ศูนย์พักพิง (SHELTER_OVERRIDE)</option>
					</select>
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

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		targetSegmentSchema,
		TARGET_SEGMENT_LABELS,
		type FoodSphereStandard,
		type TargetSegment
	} from '../domain/food-sphere';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import { useSaveFoodSphereStandard } from '../application/food-sphere-queries';

	let {
		open = $bindable(false),
		standard = null,
		shelterCode = '',
		isSA = false,
		onClose
	}: {
		open: boolean;
		standard: FoodSphereStandard | null;
		shelterCode?: string;
		isSA?: boolean;
		onClose: () => void;
	} = $props();

	const reqGroupsQuery = useRequirementGroups(() => shelterCode);
	const saveMutation = useSaveFoodSphereStandard();

	let formSegment = $state<TargetSegment>('ALL');
	let formReqGroupId = $state('');
	let formDailyDemand = $state<number | string>('');
	let formEffectiveDate = $state(new Date().toISOString().slice(0, 10));
	let formSource = $state<'SPHERE_BASELINE' | 'SHELTER_OVERRIDE'>('SPHERE_BASELINE');
	let formErrors = $state<Record<string, string>>({});

	const groups = $derived(reqGroupsQuery.data ?? []);

	// Auto-fill UOM from selected requirement group (Invariant 2, FR-SPHERE-02)
	const selectedGroup = $derived(
		groups.find(
			(g) =>
				g._id === `req_group:${formReqGroupId}` ||
				g._id === formReqGroupId ||
				g.name === formReqGroupId
		)
	);
	const autoUom = $derived(selectedGroup?.standard_uom ?? standard?.standard_uom ?? '—');

	$effect(() => {
		if (standard) {
			formSegment = standard.target_segment;
			formReqGroupId = standard.req_group_id;
			formDailyDemand = standard.daily_demand;
			formEffectiveDate = standard.effective_date;
			formSource = standard.source;
		} else {
			formSegment = 'ALL';
			formReqGroupId = groups[0] ? groups[0]._id.replace(/^req_group:/, '') : '';
			formDailyDemand = '';
			formEffectiveDate = new Date().toISOString().slice(0, 10);
			formSource = shelterCode && !isSA ? 'SHELTER_OVERRIDE' : 'SPHERE_BASELINE';
		}
		formErrors = {};
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		formErrors = {};

		if (!formSegment) {
			formErrors.segment = 'กรุณาเลือก Target Segment';
		}
		const cleanGroupId = formReqGroupId
			.trim()
			.toUpperCase()
			.replace(/^REQ_GROUP:/, '');
		if (!cleanGroupId) {
			formErrors.reqGroupId = 'กรุณาระบุกลุ่มความต้องการ';
		}
		const demand = Number(formDailyDemand);
		if (isNaN(demand) || demand <= 0) {
			formErrors.dailyDemand = 'ปริมาณความต้องการต้องมากกว่า 0';
		}
		if (!formEffectiveDate) {
			formErrors.effectiveDate = 'กรุณาระบุวันที่มีผลบังคับใช้';
		}

		if (Object.keys(formErrors).length > 0) {
			return;
		}

		const docId = `sphere:${formSegment}:${cleanGroupId}`;
		await saveMutation.mutateAsync({
			id: docId,
			input: {
				target_segment: formSegment,
				req_group_id: cleanGroupId,
				daily_demand: demand,
				standard_uom: autoUom !== '—' ? autoUom : undefined,
				effective_date: formEffectiveDate,
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
		aria-labelledby="food-sphere-modal-title"
	>
		<div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-6 shadow-xl">
			<h2 id="food-sphere-modal-title" class="text-lg font-semibold">
				{standard ? 'แก้ไขเกณฑ์มาตรฐานโภชนาการ' : 'เพิ่มเกณฑ์มาตรฐานโภชนาการ (Sphere Standard)'}
			</h2>

			<form onsubmit={handleSubmit} class="mt-4 space-y-4">
				<div>
					<label for="form-segment" class="block text-sm font-medium">
						กลุ่มเป้าหมาย (Target Segment) <span class="text-destructive">*</span>
					</label>
					<select
						id="form-segment"
						aria-label="Segment"
						bind:value={formSegment}
						disabled={!!standard}
						class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
					>
						{#each targetSegmentSchema.options as segment (segment)}
							<option value={segment}>{TARGET_SEGMENT_LABELS[segment] ?? segment}</option>
						{/each}
					</select>
					{#if formErrors.segment}
						<p class="mt-1 text-xs text-destructive">{formErrors.segment}</p>
					{/if}
				</div>

				<div>
					<label for="form-req-group" class="block text-sm font-medium">
						กลุ่มความต้องการ (Requirement Group) <span class="text-destructive">*</span>
					</label>
					{#if groups.length > 0}
						<select
							id="form-req-group"
							aria-label="กลุ่มความต้องการ"
							bind:value={formReqGroupId}
							disabled={!!standard}
							class="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
						>
							{#each groups as g (g)}
								{@const cleanId = g._id.replace(/^req_group:/, '')}
								<option value={cleanId}>{g.name} ({cleanId})</option>
							{/each}
						</select>
					{:else}
						<Input
							id="form-req-group"
							aria-label="กลุ่มความต้องการ"
							bind:value={formReqGroupId}
							disabled={!!standard}
							placeholder="เช่น FOOD_ENERGY"
							class="mt-1 font-mono uppercase"
						/>
					{/if}
					{#if formErrors.reqGroupId}
						<p class="mt-1 text-xs text-destructive">{formErrors.reqGroupId}</p>
					{/if}
				</div>

				<!-- Auto-fill UOM display (FR-SPHERE-02, Invariant 2, data-testid="uom-display") -->
				<div class="rounded-lg bg-muted/40 p-3">
					<div class="text-xs text-muted-foreground">หน่วยนับมาตรฐานของกลุ่ม (Standard UOM):</div>
					<div class="mt-1 font-mono text-sm font-semibold text-foreground">
						<span data-testid="uom-display">{autoUom}</span>
					</div>
				</div>

				<div>
					<label for="form-daily-demand" class="block text-sm font-medium">
						ปริมาณความต้องการต่อคนต่อวัน (Daily Demand) <span class="text-destructive">*</span>
					</label>
					<Input
						id="form-daily-demand"
						aria-label="ปริมาณต่อวัน"
						type="number"
						step="any"
						min="0.0001"
						bind:value={formDailyDemand}
						placeholder="เช่น 2100"
						class="mt-1"
					/>
					{#if formErrors.dailyDemand}
						<p class="mt-1 text-xs text-destructive">{formErrors.dailyDemand}</p>
					{/if}
				</div>

				<div>
					<label for="form-effective-date" class="block text-sm font-medium">
						วันที่มีผลบังคับใช้ (Effective Date) <span class="text-destructive">*</span>
					</label>
					<Input
						id="form-effective-date"
						aria-label="วันบังคับใช้"
						type="date"
						bind:value={formEffectiveDate}
						class="mt-1"
					/>
					{#if formErrors.effectiveDate}
						<p class="mt-1 text-xs text-destructive">{formErrors.effectiveDate}</p>
					{/if}
				</div>

				<div>
					<label for="form-source-sphere" class="block text-sm font-medium">
						แหล่งที่มา (Source)
					</label>
					<select
						id="form-source-sphere"
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

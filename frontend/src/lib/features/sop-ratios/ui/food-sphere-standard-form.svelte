<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		targetSegmentSchema,
		TARGET_SEGMENT_LABELS,
		type FoodSphereStandard,
		type TargetSegment
	} from '../domain/food-sphere';
	import { resolveSource, type Source } from '$lib/utils/source';
	import { useRequirementGroups } from '../application/requirement-group-queries';
	import { useSaveFoodSphereStandard } from '../application/food-sphere-queries';
	import { toast } from 'svelte-sonner';

	let {
		standard = null,
		isEdit = false,
		shelterCode = '',
		onsuccess,
		oncancel
	}: {
		standard?: FoodSphereStandard | null;
		isEdit?: boolean;
		shelterCode?: string;
		onsuccess?: () => void;
		oncancel?: () => void;
	} = $props();

	const reqGroupsQuery = useRequirementGroups(() => shelterCode);
	const saveMutation = useSaveFoodSphereStandard();

	let formSegment = $state<TargetSegment>('ALL');
	let formReqGroupId = $state('');
	let formDailyDemand = $state<number | string>('');
	let formEffectiveDate = $state(new Date().toISOString().slice(0, 10));
	let formErrors = $state<Record<string, string>>({});

	const groups = $derived(reqGroupsQuery.data ?? []);

	// Auto-fill UOM from selected requirement group (Invariant 2, FR-SPHERE-02)
	const selectedGroup = $derived(
		groups.find(
			(g) =>
				g._id === `requirement_group:${formReqGroupId}` ||
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
		} else {
			formSegment = 'ALL';
			formReqGroupId = groups[0] ? groups[0]._id.replace(/^requirement_group:/, '') : '';
			formDailyDemand = '';
			formEffectiveDate = new Date().toISOString().slice(0, 10);
		}
		formErrors = {};
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		formErrors = {};

		if (!formSegment) {
			formErrors.segment = 'กรุณาเลือกกลุ่มเป้าหมาย (Target Segment)';
		}
		const cleanGroupId = formReqGroupId
			.trim()
			.toUpperCase()
			.replace(/^REQUIREMENT_GROUP:/, '');
		if (!cleanGroupId) {
			formErrors.reqGroupId = 'กรุณาระบุหมวดความต้องการ';
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

		const computedSource: Source = resolveSource(shelterCode);
		const docId = `food_sphere_standard:${formSegment}:${cleanGroupId}`;
		try {
			await saveMutation.mutateAsync({
				id: docId,
				input: {
					target_segment: formSegment,
					req_group_id: cleanGroupId,
					daily_demand: demand,
					standard_uom: autoUom !== '—' ? autoUom : undefined,
					effective_date: formEffectiveDate,
					source: computedSource,
					shelter_code: computedSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
				},
				shelterCode: computedSource === 'SHELTER_OVERRIDE' ? shelterCode : undefined
			});
			toast.success(
				isEdit
					? `ปรับปรุงเกณฑ์โภชนาการสำหรับ ${TARGET_SEGMENT_LABELS[formSegment] ?? formSegment} (${cleanGroupId}) สำเร็จ`
					: `เพิ่มเกณฑ์โภชนาการสำหรับ ${TARGET_SEGMENT_LABELS[formSegment] ?? formSegment} (${cleanGroupId}) สำเร็จ`
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
			<!-- Row 1: Target Segment & Requirement Group -->
			<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
				<!-- กลุ่มเป้าหมาย (Target Segment) -->
				<Field.Field>
					<Field.Label for="form-segment">
						กลุ่มเป้าหมาย <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Select.Root type="single" bind:value={formSegment} disabled={isEdit}>
						<Select.Trigger
							id="form-segment"
							class="h-9 w-full rounded-md border-input bg-background"
						>
							{TARGET_SEGMENT_LABELS[formSegment] ?? formSegment}
						</Select.Trigger>
						<Select.Content>
							{#each targetSegmentSchema.options as segment (segment)}
								<Select.Item value={segment} label={TARGET_SEGMENT_LABELS[segment] ?? segment} />
							{/each}
						</Select.Content>
					</Select.Root>
					{#if formErrors.segment}
						<Field.Error>{formErrors.segment}</Field.Error>
					{/if}
				</Field.Field>

				<!-- หมวดความต้องการ (Requirement Group) -->
				<Field.Field>
					<Field.Label for="form-req-group">
						หมวดความต้องการ <span class="font-bold text-destructive">*</span>
					</Field.Label>
					{#if groups.length > 0}
						<Select.Root type="single" bind:value={formReqGroupId} disabled={isEdit}>
							<Select.Trigger
								id="form-req-group"
								class="h-9 w-full rounded-md border-input bg-background font-mono"
							>
								{selectedGroup
									? `${selectedGroup.name} (${selectedGroup._id.replace(/^requirement_group:/, '')})`
									: formReqGroupId || 'เลือกหมวดความต้องการ'}
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
							id="form-req-group"
							aria-label="กลุ่มความต้องการ"
							bind:value={formReqGroupId}
							disabled={isEdit}
							placeholder="เช่น FOOD_ENERGY"
							class="font-mono uppercase"
						/>
					{/if}
					{#if formErrors.reqGroupId}
						<Field.Error>{formErrors.reqGroupId}</Field.Error>
					{/if}
				</Field.Field>
			</Field.FieldGroup>

			<!-- Row 2: ปริมาณที่ต้องการต่อคนต่อวัน & หน่วยนับ (UOM) AUTO-FILL -->
			<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
				<Field.Field>
					<Field.Label for="form-daily-demand">
						ปริมาณที่ต้องการต่อคนต่อวัน <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-daily-demand"
						aria-label="ปริมาณต่อวัน"
						type="number"
						step="any"
						min="0.0001"
						bind:value={formDailyDemand}
						placeholder="0"
					/>
					{#if formErrors.dailyDemand}
						<Field.Error>{formErrors.dailyDemand}</Field.Error>
					{/if}
				</Field.Field>

				<Field.Field>
					<div class="flex items-center gap-2">
						<Field.Label>หน่วยนับ</Field.Label>
						<span
							class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase"
						>
							เติมอัตโนมัติ
						</span>
					</div>
					<div
						class="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 font-mono text-sm text-muted-foreground"
					>
						<span data-testid="uom-display">{autoUom}</span>
					</div>
				</Field.Field>
			</Field.FieldGroup>

			<!-- Row 3: วันที่มีผลบังคับใช้ -->
			<Field.FieldGroup class="grid grid-cols-1 gap-5 md:grid-cols-2">
				<Field.Field>
					<Field.Label for="form-effective-date">
						วันที่มีผลบังคับใช้ <span class="font-bold text-destructive">*</span>
					</Field.Label>
					<Input
						id="form-effective-date"
						aria-label="วันบังคับใช้"
						type="date"
						bind:value={formEffectiveDate}
					/>
					{#if formErrors.effectiveDate}
						<Field.Error>{formErrors.effectiveDate}</Field.Error>
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

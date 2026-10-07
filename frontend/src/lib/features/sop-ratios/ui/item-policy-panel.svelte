<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { resolveSource } from '$lib/utils/source';
	import {
		findItemPolicy,
		itemPolicyTargetId,
		replenishmentPolicyDocId,
		replenishmentPolicyInputSchema
	} from '../domain/replenishment-policy';
	import {
		useReplenishmentPolicies,
		useSaveReplenishmentPolicy
	} from '../application/replenishment-queries';

	let {
		itemId,
		itemName,
		shelterCode = ''
	}: {
		itemId: string;
		itemName: string;
		shelterCode?: string;
	} = $props();

	const policiesQuery = useReplenishmentPolicies(() => shelterCode);
	const saveMutation = useSaveReplenishmentPolicy();

	const existing = $derived(findItemPolicy(itemId, policiesQuery.data ?? []));

	// Seeded from the saved policy (or the defaults); re-seeds when the item or saved doc changes,
	// and stays writable for the inputs.
	let leadTime = $derived<number | string>(existing?.lead_time_days ?? 2);
	let reviewPeriod = $derived<number | string>(existing?.review_period_days ?? 3);
	let safetyDays = $derived<number | string>(existing?.safety_days ?? 2);
	let minDoc = $derived<number | string>(existing?.min_doc_days ?? 2);
	let maxDoc = $derived<number | string>(existing?.max_doc_days ?? 30);
	let status = $derived<'active' | 'inactive'>(existing?.status ?? 'active');
	let errors = $derived.by<Record<string, string>>(() => {
		void existing;
		return {};
	});

	const standardReorderDays = $derived(
		(Number(leadTime) || 0) + (Number(reviewPeriod) || 0) + (Number(safetyDays) || 0)
	);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		const targetId = itemPolicyTargetId(itemId);
		const source = resolveSource(shelterCode);
		const parsed = replenishmentPolicyInputSchema.safeParse({
			scope_type: 'ITEM',
			target_id: targetId,
			lead_time_days: leadTime,
			review_period_days: reviewPeriod,
			safety_days: safetyDays,
			min_doc_days: minDoc,
			max_doc_days: maxDoc,
			status,
			source,
			shelter_code: source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
		});
		if (!parsed.success) {
			const next: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = String(issue.path[0] ?? 'form');
				next[key] ??= issue.message;
			}
			errors = next;
			return;
		}
		errors = {};
		await saveMutation.mutateAsync({
			id: replenishmentPolicyDocId('ITEM', targetId),
			input: parsed.data,
			shelterCode: source === 'SHELTER_OVERRIDE' ? shelterCode : undefined
		});
	}
</script>

{#if policiesQuery.isLoading}
	<div class="space-y-3" aria-busy="true">
		{#each [0, 1, 2] as i (i)}
			<div class="h-12 animate-pulse rounded-xl border border-slate-200/80 bg-slate-50"></div>
		{/each}
	</div>
{:else if policiesQuery.isError}
	<p class="text-sm font-semibold text-destructive">
		โหลดนโยบายไม่สำเร็จ: {policiesQuery.error?.message}
	</p>
{:else}
	<form onsubmit={handleSubmit} class="space-y-4">
		<p class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900">
			นโยบายเติมสต็อกของ <strong>{itemName}</strong>
			{existing ? 'เฉพาะรายสินค้า' : '— ยังไม่ได้ตั้งค่าเฉพาะสินค้านี้'}
			ใช้ในหน้าวิเคราะห์ความต้องการพื้นฐาน (Food Sphere) ไม่ได้เปลี่ยน "เกณฑ์" ที่แสดงในตารางคลัง
		</p>

		<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<Field.Field>
				<Field.Label for="item-policy-lead">ระยะเวลารอคอย (วัน)</Field.Label>
				<Input
					id="item-policy-lead"
					type="number"
					inputmode="numeric"
					min="0"
					class="min-h-11"
					bind:value={leadTime}
				/>
				{#if errors.lead_time_days}<Field.Error>{errors.lead_time_days}</Field.Error>{/if}
			</Field.Field>
			<Field.Field>
				<Field.Label for="item-policy-review">รอบการสั่งซื้อ (วัน)</Field.Label>
				<Input
					id="item-policy-review"
					type="number"
					inputmode="numeric"
					min="0"
					class="min-h-11"
					bind:value={reviewPeriod}
				/>
				{#if errors.review_period_days}<Field.Error>{errors.review_period_days}</Field.Error>{/if}
			</Field.Field>
			<Field.Field>
				<Field.Label for="item-policy-safety">วันสำรองฉุกเฉิน (วัน)</Field.Label>
				<Input
					id="item-policy-safety"
					type="number"
					inputmode="numeric"
					min="0"
					class="min-h-11"
					bind:value={safetyDays}
				/>
				{#if errors.safety_days}<Field.Error>{errors.safety_days}</Field.Error>{/if}
			</Field.Field>
		</Field.FieldGroup>

		<div
			class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
		>
			<div>
				<div class="text-sm font-semibold text-slate-900">จำนวนวันสั่งเติมมาตรฐาน</div>
				<div class="text-xs text-slate-500">รอคอย + รอบสั่งซื้อ + วันสำรอง</div>
			</div>
			<div class="text-xl font-bold text-slate-900 tabular-nums">
				<span data-testid="item-policy-reorder-days">{standardReorderDays}</span> วัน
			</div>
		</div>

		<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<Field.Field>
				<Field.Label for="item-policy-min">วันคงคลังขั้นต่ำ (วัน)</Field.Label>
				<Input
					id="item-policy-min"
					type="number"
					inputmode="numeric"
					min="0"
					class="min-h-11"
					bind:value={minDoc}
				/>
				{#if errors.min_doc_days}<Field.Error>{errors.min_doc_days}</Field.Error>{/if}
			</Field.Field>
			<Field.Field>
				<Field.Label for="item-policy-max">วันคงคลังสูงสุด (วัน)</Field.Label>
				<Input
					id="item-policy-max"
					type="number"
					inputmode="numeric"
					min="0"
					class="min-h-11"
					bind:value={maxDoc}
				/>
				{#if errors.max_doc_days}<Field.Error>{errors.max_doc_days}</Field.Error>{/if}
			</Field.Field>
		</Field.FieldGroup>

		<Field.Field>
			<Field.Label for="item-policy-status">สถานะการใช้งาน</Field.Label>
			<Select.Root type="single" bind:value={status}>
				<Select.Trigger id="item-policy-status" class="min-h-11 w-full">
					{status === 'active' ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="active" label="เปิดใช้งาน" />
					<Select.Item value="inactive" label="ปิดใช้งาน" />
				</Select.Content>
			</Select.Root>
		</Field.Field>

		<Button
			type="submit"
			disabled={saveMutation.isPending}
			class="min-h-11 w-full rounded-lg bg-[#0A2647] text-sm font-semibold text-white hover:bg-[#051930]"
		>
			{saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกนโยบาย'}
		</Button>
	</form>
{/if}

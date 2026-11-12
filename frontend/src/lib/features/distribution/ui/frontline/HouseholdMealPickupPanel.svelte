<script lang="ts">
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader from '@lucide/svelte/icons/loader';
	import Users from '@lucide/svelte/icons/users';
	import Info from '@lucide/svelte/icons/info';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { qtyGte } from '$lib/utils/qty';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { itemAllergens, type ItemMaster } from '$lib/features/catalog';
	import { useMasterData } from '$lib/features/master-data';
	import { useHousehold, useHouseholdMembers } from '$lib/features/people';
	import {
		useEvacueeAllergies,
		useRecipientsDistributionLogs,
		useRecordHouseholdMealPickup
	} from '../../application/queries';
	import type { MealPeriod, TicketItem } from '../../domain/food-supplies';
	import type { FoodDistributionInput } from '../../application/food-supplies/distribution-workflow';
	import {
		buildHouseholdPickupRows,
		householdHeading,
		isSelectedByDefault,
		notPreselectedReasons,
		picksAfterPartialFailure,
		summarizeHouseholdPickup
	} from '../model/household-pickup';
	import { formatDistributionError } from '../model/distribution-error';

	interface Props {
		ticketId: string;
		meal: MealPeriod;
		item: TicketItem;
		menu: ItemMaster | undefined;
		inHandQty: string;
		collectorId: string;
		/** CR-233 A1: the collector's expired-QR audit dates, recorded on their own log only. */
		collectorQrOverride?: FoodDistributionInput['recipient_qr_override'];
		householdId: string;
		notes: string;
		shelterCode?: string;
		canDistribute: boolean;
		/** Epoch ms from the desk clock, so "received today" rolls over at Thai midnight. */
		now: number;
		/** All selected members were recorded. */
		ondone: () => void;
	}

	let {
		ticketId,
		meal,
		item,
		menu,
		inHandQty,
		collectorId,
		collectorQrOverride,
		householdId,
		notes = $bindable(''),
		shelterCode,
		canDistribute,
		now,
		ondone
	}: Props = $props();

	const mutation = useRecordHouseholdMealPickup();

	const householdQuery = useHousehold(() => householdId);
	const membersQuery = useHouseholdMembers(() => householdId);
	const members = $derived(membersQuery.data ?? []);
	const memberIds = $derived(members.map((m) => m._id));
	const logsQuery = useRecipientsDistributionLogs(
		() => memberIds,
		() => shelterCode
	);
	const allergiesQuery = useEvacueeAllergies(
		() => memberIds,
		() => shelterCode
	);
	const allergyQuery = useMasterData(
		() => 'allergy',
		() => ({ scope: 'global' })
	);

	const queries = $derived([membersQuery, logsQuery, allergiesQuery, allergyQuery]);
	// Never build rows before the logs and allergies arrive (paused offline or disabled included),
	// or members would be pre-ticked without the repeat-meal and allergy checks. The member-scoped
	// queries only run once there are members, so an empty household does not wait on them.
	const loading = $derived(
		membersQuery.isPending ||
			allergyQuery.isPending ||
			(memberIds.length > 0 && (logsQuery.isPending || allergiesQuery.isPending))
	);
	const loadError = $derived(queries.some((q) => q.isError));

	const allergyItems = $derived(allergyQuery.data?.items ?? []);
	const rows = $derived(
		buildHouseholdPickupRows({
			members,
			logs: logsQuery.data ?? [],
			meal,
			at: new Date(now).toISOString(),
			collectorId,
			menu,
			menuAllergens: menu ? itemAllergens(menu) : [],
			allergiesByEvacuee: allergiesQuery.data ?? {},
			allergyItems
		})
	);

	// Explicit picks keyed by collector + item + meal + member, so a new scan, or a different item
	// or meal, starts from the defaults and a typed override reason never follows it.
	let picks = $state<Record<string, boolean>>({});
	let overrideReasons = $state<Record<string, string>>({});
	// Failures belong to the scan that produced them; a new collector starts clean.
	let failureState = $state<{
		collectorId: string;
		items: { evacueeId: string; label: string; message: string }[];
	}>({ collectorId: '', items: [] });
	const failures = $derived(failureState.collectorId === collectorId ? failureState.items : []);
	const key = (evacueeId: string) => `${collectorId}|${item.item_id}|${meal}|${evacueeId}`;

	// Members whose last save failed; they stay ticked for the retry unless their write landed.
	let retryState = $state<{ collectorId: string; ids: Set<string> }>({
		collectorId: '',
		ids: new Set()
	});
	const retryIds = $derived(
		retryState.collectorId === collectorId ? retryState.ids : new Set<string>()
	);
	const isSelected = (row: (typeof rows)[number]) =>
		picks[key(row.evacueeId)] ?? isSelectedByDefault(row, retryIds);
	const selectedRows = $derived(rows.filter(isSelected));
	const summary = $derived(summarizeHouseholdPickup(rows));
	const missingReason = $derived(
		selectedRows.some((r) => r.needsOverride && !overrideReasons[key(r.evacueeId)]?.trim())
	);
	const withinInHand = $derived(qtyGte(inHandQty, String(selectedRows.length)));
	const canSubmit = $derived(
		canDistribute &&
			!loading &&
			!loadError &&
			!mutation.isPending &&
			selectedRows.length > 0 &&
			!missingReason &&
			withinInHand
	);

	function toggle(evacueeId: string, checked: boolean) {
		picks[key(evacueeId)] = checked;
	}

	function retryLoad() {
		for (const q of queries) if (q.isError) void q.refetch();
	}

	async function submit() {
		if (!canSubmit) return;
		failureState = { collectorId, items: [] };
		const labelOf = new Map(rows.map((r) => [r.evacueeId, r.label]));
		try {
			const results = await mutation.mutateAsync({
				ticketId,
				shelterCode,
				input: {
					item_id: item.item_id,
					household_id: householdId,
					collector_id: collectorId,
					collector_qr_override: collectorQrOverride,
					notes: notes.trim() || undefined,
					selections: selectedRows.map((r) => ({
						evacuee_id: r.evacueeId,
						override_reason: r.needsOverride ? overrideReasons[key(r.evacueeId)].trim() : undefined,
						menu_check: menu ? { recipient_tags: r.menuTags, menu } : undefined,
						allergen_check: {
							recipient_allergy_codes: r.allergen.recipientCodes,
							menu_allergen_codes: r.allergen.menuCodes,
							recipient_allergy_free_text: r.allergen.recipientFreeText
						}
					}))
				}
			});
			const failed = results.filter((r) => !r.ok);
			const recorded = results.length - failed.length;
			if (failed.length === 0) {
				toast.success(`บันทึกแจก ${item.item_name} ให้ ${recorded} คนสำเร็จ`);
				picks = {};
				overrideReasons = {};
				retryState = { collectorId: '', ids: new Set() };
				notes = '';
				ondone();
				return;
			}
			if (recorded > 0) toast.success(`บันทึกสำเร็จ ${recorded} คน`);
			failureState = {
				collectorId,
				items: failed.map((r) => ({
					evacueeId: r.evacuee_id,
					label: labelOf.get(r.evacuee_id) ?? r.evacuee_id,
					message: formatDistributionError(r.ok ? null : r.error, 'บันทึกไม่สำเร็จ')
				}))
			};
			// Retry only the failed members (#1154 R8).
			const failedIds = new Set(failed.map((r) => r.evacuee_id));
			retryState = { collectorId, ids: failedIds };
			picks = picksAfterPartialFailure(rows, failedIds, key);
		} catch (err) {
			toast.error(formatDistributionError(err, 'ไม่สามารถบันทึกแจกอาหารได้ กรุณาลองใหม่อีกครั้ง'));
		}
	}
</script>

<fieldset class="space-y-3">
	<legend class="w-full">
		<span class="flex flex-wrap items-center justify-between gap-2">
			<span class="flex items-center gap-2 text-base font-semibold text-slate-800">
				<Users class="size-5 text-slate-500" aria-hidden="true" />
				{householdHeading(householdQuery.data?.label)}
			</span>
		</span>
		<span class="mt-0.5 block text-sm text-slate-500">
			รับแทนสมาชิกครอบครัว · แสดงเฉพาะสมาชิกที่อยู่ในศูนย์
		</span>
	</legend>
	{#if !loading && !loadError && rows.length > 0}
		<div class="flex flex-wrap gap-2" aria-live="polite">
			<p
				class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900 tabular-nums"
			>
				รับมื้อนี้แล้ว {summary.received} จาก {summary.total} คน
			</p>
			<p
				class="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900 tabular-nums"
			>
				เลือก {selectedRows.length} จาก {rows.length} คน
			</p>
		</div>
	{/if}

	{#if loading}
		<p class="flex items-center gap-2 text-sm text-slate-600">
			<Loader class="size-4 animate-spin" aria-hidden="true" />
			กำลังโหลดสมาชิกและประวัติการรับ...
		</p>
	{:else if loadError}
		<div
			class="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
			role="alert"
		>
			<AlertCircle class="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
			<p class="flex-1">โหลดสมาชิก ประวัติการรับ หรือข้อมูลการแพ้ไม่สำเร็จ ยังบันทึกไม่ได้</p>
			<Button type="button" variant="outline" size="sm" onclick={retryLoad}>ลองใหม่</Button>
		</div>
	{:else}
		<ul class="grid grid-cols-1 gap-3 md:grid-cols-2">
			{#each rows as row (row.evacueeId)}
				{@const checked = isSelected(row)}
				{@const whyUnticked = notPreselectedReasons(row)}
				{@const inputId = `household-member-${row.evacueeId}`}
				<li
					class="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-2xs transition-colors {checked
						? 'border-sky-300 bg-sky-50/40'
						: 'border-slate-200/80'}"
				>
					<div class="flex items-start gap-3">
						<Checkbox
							id={inputId}
							bind:checked={() => checked, (next) => toggle(row.evacueeId, next === true)}
							disabled={mutation.isPending}
							class="mt-0.5 size-6 rounded-md"
						/>
						<div class="min-w-0 flex-1 space-y-1">
							<Label
								for={inputId}
								class="flex min-h-6 cursor-pointer flex-wrap items-center gap-2 text-base font-semibold break-words text-slate-900"
							>
								{row.label}
								{#if row.isCollector}
									<span
										class="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700"
									>
										ผู้มารับ
									</span>
								{/if}
							</Label>
							{#if row.allergyLabel}
								<p class="text-sm text-slate-700">
									<span class="font-semibold text-red-800">แพ้:</span>
									{row.allergyLabel}
								</p>
							{/if}
						</div>
					</div>

					{#if whyUnticked.length > 0}
						<div
							class="rounded-lg border p-3 text-sm {row.allergenConflictLabel
								? 'border-red-200 bg-red-50 text-red-900'
								: 'border-amber-200 bg-amber-50 text-amber-900'}"
						>
							<p class="flex items-center gap-1.5 font-semibold">
								<Info class="size-4 shrink-0" aria-hidden="true" />
								{checked ? 'ต้องใส่เหตุผล เพราะ' : 'ไม่ได้เลือกไว้ให้ เพราะ'}
							</p>
							<ul class="mt-1 list-disc space-y-0.5 pl-6">
								{#each whyUnticked as reason (reason)}
									<li>{reason}</li>
								{/each}
							</ul>
							{#if !checked}
								<p class="mt-1.5 text-xs">ถ้าจะแจกให้คนนี้ ติ๊กเลือกแล้วใส่เหตุผล</p>
							{/if}
						</div>
					{/if}

					{#if !row.allergenConflictLabel && row.allergen.menuUnspecified}
						<p class="text-sm text-slate-600">เมนูนี้ไม่ระบุสารก่อแพ้ — ตรวจสอบกับครัวก่อนแจก</p>
					{/if}
					{#if (row.allergyLabel || row.allergen.recipientFreeText.length > 0) && row.allergen.menuFreeText.length > 0}
						<p class="text-sm text-slate-600">
							เมนูระบุ: {row.allergen.menuFreeText.join(', ')} — ระบบไม่ได้เทียบให้
						</p>
					{/if}

					{#if checked && row.needsOverride}
						<div class="space-y-1.5">
							<Label for={`${inputId}-reason`} class="text-sm font-semibold text-slate-700">
								เหตุผลที่แจกให้ <span class="text-red-600">*</span>
							</Label>
							<Input
								id={`${inputId}-reason`}
								type="text"
								class="h-12 text-base"
								placeholder="เช่น หัวหน้าครอบครัวยืนยันแล้ว"
								bind:value={overrideReasons[key(row.evacueeId)]}
								disabled={mutation.isPending}
							/>
						</div>
					{/if}
				</li>
			{:else}
				<li class="text-sm text-slate-600 md:col-span-2">ไม่มีสมาชิกที่อยู่ในศูนย์</li>
			{/each}
		</ul>
	{/if}

	{#if failures.length > 0}
		<div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
			<p class="font-bold">บันทึกไม่สำเร็จ {failures.length} คน — กดยืนยันอีกครั้งเพื่อลองใหม่</p>
			<ul class="mt-1 list-disc pl-5">
				{#each failures as failure (failure.evacueeId)}
					<li>{failure.label}: {failure.message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="space-y-1.5">
		<Label for="household-notes-input" class="text-sm font-semibold text-slate-700">
			หมายเหตุ (ไม่บังคับ)
		</Label>
		<Input
			id="household-notes-input"
			type="text"
			bind:value={notes}
			class="h-12 text-base"
			disabled={mutation.isPending}
		/>
	</div>

	{#if !withinInHand}
		<p class="text-sm text-red-700" role="alert">จำนวนที่เลือกเกินยอดคงเหลือในมือ ({inHandQty})</p>
	{/if}

	<Button
		type="button"
		onclick={submit}
		disabled={!canSubmit}
		class="h-14 w-full rounded-xl bg-amber-600 text-base font-bold hover:bg-amber-700"
	>
		{#if mutation.isPending}
			<Loader class="size-5 animate-spin" aria-hidden="true" />
			<span>กำลังบันทึก...</span>
		{:else}
			<CheckCircle2 class="size-5" aria-hidden="true" />
			<span>ยืนยันแจก {item.item_name} ให้ {selectedRows.length} คน</span>
		{/if}
	</Button>
	{#if !canDistribute}
		<p class="text-center text-sm text-slate-500">
			บัญชีนี้ไม่มีสิทธิ์บันทึกการแจกอาหาร (ต้องเป็นเจ้าหน้าที่แจกจ่ายหรือผู้จัดการศูนย์)
		</p>
	{/if}
</fieldset>

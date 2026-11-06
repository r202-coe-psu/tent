<script lang="ts">
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader from '@lucide/svelte/icons/loader';
	import Users from '@lucide/svelte/icons/users';
	import { qtyGte } from '$lib/utils/qty';
	import { formatThaiTime } from '$lib/utils/date';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { itemAllergens, type ItemMaster } from '$lib/features/catalog';
	import { useMasterData } from '$lib/features/master-data';
	import { useHouseholdMembers } from '$lib/features/people';
	import {
		useEvacueeAllergies,
		useRecipientsDistributionLogs,
		useRecordHouseholdMealPickup
	} from '../../application/queries';
	import type { MealPeriod, TicketItem } from '../../domain/food-supplies';
	import { buildHouseholdPickupRows, isPreselected } from '../model/household-pickup';
	import { formatDistributionError } from '../model/distribution-error';

	interface Props {
		ticketId: string;
		meal: MealPeriod;
		item: TicketItem;
		menu: ItemMaster | undefined;
		inHandQty: string;
		collectorId: string;
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
		householdId,
		notes = $bindable(''),
		shelterCode,
		canDistribute,
		now,
		ondone
	}: Props = $props();

	const mutation = useRecordHouseholdMealPickup();

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
	const loading = $derived(queries.some((q) => q.isPending));
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

	// Explicit picks keyed by collector + member, so a new scan starts from the defaults.
	let picks = $state<Record<string, boolean>>({});
	let reasons = $state<Record<string, string>>({});
	// Failures belong to the scan that produced them; a new collector starts clean.
	let failureState = $state<{
		collectorId: string;
		items: { evacueeId: string; label: string; message: string }[];
	}>({ collectorId: '', items: [] });
	const failures = $derived(failureState.collectorId === collectorId ? failureState.items : []);
	const key = (evacueeId: string) => `${collectorId}|${evacueeId}`;

	const isSelected = (row: (typeof rows)[number]) =>
		picks[key(row.evacueeId)] ?? isPreselected(row);
	const selectedRows = $derived(rows.filter(isSelected));
	const missingReason = $derived(
		selectedRows.some((r) => r.needsOverride && !reasons[key(r.evacueeId)]?.trim())
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
					notes: notes.trim() || undefined,
					selections: selectedRows.map((r) => ({
						evacuee_id: r.evacueeId,
						override_reason: r.needsOverride ? reasons[key(r.evacueeId)].trim() : undefined,
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
				reasons = {};
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
			picks = Object.fromEntries(rows.map((r) => [key(r.evacueeId), failedIds.has(r.evacueeId)]));
		} catch (err) {
			toast.error(formatDistributionError(err, 'ไม่สามารถบันทึกแจกอาหารได้ กรุณาลองใหม่อีกครั้ง'));
		}
	}
</script>

<div class="space-y-1.5">
	<Label for="food-notes-input" class="text-sm font-semibold text-slate-700">
		หมายเหตุ (ไม่บังคับ)
	</Label>
	<Input
		id="food-notes-input"
		type="text"
		bind:value={notes}
		class="h-12 text-sm"
		disabled={mutation.isPending}
	/>
</div>

<fieldset class="space-y-3">
	<legend class="flex items-center gap-2 text-sm font-semibold text-slate-700">
		<Users class="size-4" aria-hidden="true" />
		รับแทนสมาชิกครัวเรือน (เฉพาะคนที่อยู่ในศูนย์)
	</legend>

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
		<ul class="space-y-2">
			{#each rows as row (row.evacueeId)}
				{@const checked = isSelected(row)}
				<li
					class="rounded-xl border p-3 {checked
						? 'border-amber-400 bg-amber-50/40'
						: 'border-slate-200 bg-white'}"
				>
					<label class="flex min-h-11 cursor-pointer items-start gap-3">
						<input
							type="checkbox"
							class="mt-1 size-5 accent-amber-600"
							{checked}
							disabled={mutation.isPending}
							onchange={(e) => toggle(row.evacueeId, e.currentTarget.checked)}
						/>
						<span class="min-w-0 flex-1">
							<span class="block font-semibold break-words text-slate-900">
								{row.label}
								{#if row.isCollector}
									<span class="ml-1 text-xs font-medium text-slate-500">(ผู้มารับ)</span>
								{/if}
							</span>
							{#if row.lastDistributedAt}
								<span class="block text-xs font-semibold text-amber-800">
									รับมื้อนี้แล้ว เวลา {formatThaiTime(row.lastDistributedAt)}
								</span>
							{/if}
							{#if row.allergyLabel}
								<span class="block text-xs font-semibold text-red-800">แพ้: {row.allergyLabel}</span
								>
							{/if}
							{#if row.allergenConflictLabel}
								<span class="block text-xs text-red-800">
									เมนูนี้มี {row.allergenConflictLabel} — ผู้รับแพ้
								</span>
							{/if}
							{#if row.allergen.recipientFreeText.length > 0}
								<span class="block text-xs text-amber-800">
									แพ้ (ไม่อยู่ในรายการ): {row.allergen.recipientFreeText.join(', ')}
								</span>
							{/if}
							{#if row.menuMismatchLabel}
								<span class="block text-xs text-amber-800">
									เมนูจัดไว้สำหรับกลุ่ม {row.menuMismatchLabel}
								</span>
							{/if}
						</span>
					</label>
					{#if checked && row.needsOverride}
						<Input
							type="text"
							class="mt-2 h-11 text-sm"
							placeholder="เหตุผลกรณีพิเศษ (บังคับ)"
							aria-label={`เหตุผลกรณีพิเศษของ ${row.label}`}
							bind:value={reasons[key(row.evacueeId)]}
							disabled={mutation.isPending}
						/>
					{/if}
				</li>
			{:else}
				<li class="text-sm text-slate-600">ไม่มีสมาชิกที่อยู่ในศูนย์</li>
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
</fieldset>

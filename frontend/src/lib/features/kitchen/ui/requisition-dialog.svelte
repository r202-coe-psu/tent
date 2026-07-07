<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useIssueRequisition,
		toRequisitionInput,
		assessRequisition,
		MEAL_PERIOD_LABELS,
		type MealPlan,
		type RequisitionLineAssessment
	} from '$lib/features/kitchen';
	import { useStockBalance } from '$lib/features/operations';
	import { getShelterCode } from '$lib/db/shelter';

	let { open = $bindable(false), plan = null }: { open?: boolean; plan?: MealPlan | null } =
		$props();

	const balance = useStockBalance();
	const issue = useIssueRequisition();

	// Requested lines from the plan (pure). toRequisitionInput throws when a
	// recipe has no stock mapping — surface that instead of letting it bubble.
	const requested = $derived.by(() => {
		if (!plan) return null;
		try {
			return { items: toRequisitionInput(plan).items };
		} catch (err) {
			return { error: err instanceof Error ? err.message : 'แปลงแผนเป็นคำขอเบิกไม่ได้' };
		}
	});

	const assessment = $derived.by<RequisitionLineAssessment[]>(() => {
		if (!requested || 'error' in requested) return [];
		return assessRequisition(requested.items, balance.data ?? new Map<string, number>());
	});

	// User-entered overrides of the issued qty, keyed by plan + item. Absent key
	// ⇒ fall back to the stock-covered default, so switching plans or reopening
	// starts fresh with no carryover — no $effect/seed needed. Cleared on close.
	let edits = $state<Record<string, number>>({});

	// Effective issued qty per line: the user override when present, else the
	// stock-covered default; always clamped to [0, qty_issuable] so a requisition
	// never over-issues.
	const rows = $derived(
		assessment.map((a) => {
			const key = `${plan?._id ?? ''}::${a.item_id}`;
			const raw = key in edits ? edits[key] : a.qty_issuable;
			const qty = Math.min(Math.max(0, Number(raw) || 0), a.qty_issuable);
			return { a, key, qty };
		})
	);

	const hasShortfall = $derived(assessment.some((a) => a.shortfall > 0));
	const canIssue = $derived(rows.some((r) => r.qty > 0));

	const STATUS: Record<string, { label: string; class: string }> = {
		ok: { label: 'สต็อกพอ', class: 'bg-green-100 text-green-800' },
		partial: { label: 'ไม่พอ — เบิกได้บางส่วน', class: 'bg-amber-100 text-amber-800' },
		out: { label: 'ไม่มีสต็อก', class: 'bg-red-100 text-red-700' }
	};

	// Close + discard any pending overrides. Covers the button paths; the
	// escape/overlay close is handled by onOpenChange on Dialog.Root.
	function close() {
		edits = {};
		open = false;
	}

	// Dialog open/close from escape/overlay: mirror the flag and discard pending
	// overrides on close, same as the cancel button's close().
	function handleOpenChange(v: boolean) {
		open = v;
		if (!v) edits = {};
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!plan || !requested || 'error' in requested) return;
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		const items = rows.map((r) => ({
			item_id: r.a.item_id,
			qty_requested: r.a.qty_requested,
			qty_issued: r.qty,
			unit: r.a.unit
		}));
		try {
			await issue.mutateAsync({ input: { meal_plan_id: plan._id, items }, ctx });
			toast.success(
				hasShortfall ? 'เบิกวัตถุดิบบางส่วนแล้ว (สต็อกไม่พอ)' : 'เบิกวัตถุดิบและตัดสต็อกแล้ว'
			);
			close();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header class="min-w-0">
			<Dialog.Title>เบิกวัตถุดิบจากคลัง</Dialog.Title>
			<Dialog.Description class="break-words">
				{#if plan}
					แผน {MEAL_PERIOD_LABELS[plan.meal]} วันที่ {plan.date} — ตัดสต็อกผ่าน stock ledger
				{:else}
					เลือกแผนอาหารเพื่อเบิกวัตถุดิบ
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if requested && 'error' in requested}
			<p class="rounded-md bg-red-50 p-3 text-sm text-red-700">{requested.error}</p>
		{:else if balance.isPending}
			<p class="p-4 text-center text-sm text-muted-foreground">กำลังอ่านยอดคงคลัง...</p>
		{:else}
			<form onsubmit={handleSubmit} class="space-y-4">
				<div class="overflow-x-auto rounded-md border">
					<Table.Root>
						<Table.Header>
							<Table.Row class="text-xs">
								<Table.Head class="px-3">วัตถุดิบ</Table.Head>
								<Table.Head class="px-3 text-right">ขอเบิก</Table.Head>
								<Table.Head class="px-3 text-right">คงคลัง</Table.Head>
								<Table.Head class="px-3 text-center">สถานะ</Table.Head>
								<Table.Head class="px-3 text-right">จ่ายจริง</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each rows as r (r.a.item_id)}
								<Table.Row>
									<Table.Cell class="px-3 font-mono text-xs">{r.a.item_id}</Table.Cell>
									<Table.Cell class="px-3 text-right text-sm">
										{r.a.qty_requested.toLocaleString()}
										<span class="text-xs text-muted-foreground">{r.a.unit}</span>
									</Table.Cell>
									<Table.Cell class="px-3 text-right text-sm">
										{Math.max(0, r.a.on_hand).toLocaleString()}
										<span class="text-xs text-muted-foreground">{r.a.unit}</span>
									</Table.Cell>
									<Table.Cell class="px-3 text-center">
										<span
											class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium {STATUS[
												r.a.status
											].class}"
										>
											{STATUS[r.a.status].label}
										</span>
									</Table.Cell>
									<Table.Cell class="px-3 text-right">
										<div class="flex items-center justify-end gap-1.5">
											<Input
												type="number"
												min="0"
												max={r.a.qty_issuable}
												step="any"
												value={r.qty}
												oninput={(e) => (edits[r.key] = Number(e.currentTarget.value))}
												class="h-8 w-24 [appearance:textfield] text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
												disabled={r.a.qty_issuable <= 0}
											/>
											<span class="text-xs text-muted-foreground">{r.a.unit}</span>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>

				{#if hasShortfall}
					<div
						class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"
					>
						<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							สต็อกบางรายการไม่พอตามที่ขอเบิก — ระบบตั้งยอด "จ่ายจริง" เท่าที่มีให้แล้ว
							เบิกได้บางส่วน (ส่วนที่ขาดจะถูกบันทึกว่าเบิกไม่ครบ) หรือปรับยอดเองก่อนยืนยัน
						</span>
					</div>
				{:else}
					<div
						class="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800"
					>
						<PackageCheck class="h-4 w-4 shrink-0" />
						<span>สต็อกเพียงพอสำหรับทุกวัตถุดิบในแผนนี้</span>
					</div>
				{/if}

				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={close}>ยกเลิก</Button>
					<Button type="submit" disabled={issue.isPending || !canIssue}>
						{issue.isPending ? 'กำลังเบิก...' : 'ยืนยันการเบิก + ตัดสต็อก'}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

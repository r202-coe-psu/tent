<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Flame from '@lucide/svelte/icons/flame';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useIssueRequisition,
		toRequisitionInput,
		assessRequisition,
		useGasCylinderTypes,
		useGasLedger,
		gasCylinderBalance,
		MEAL_PERIOD_LABELS,
		type MealPlan,
		type RequisitionLineAssessment
	} from '$lib/features/kitchen';
	import { useStockBalance } from '$lib/features/operations';
	import { useItemMasters, getItemDisplayName } from '$lib/features/catalog';
	import { useSupplyItems } from '$lib/features/supply';
	import { getShelterCode } from '$lib/db/shelter';
	import { persistQty, qtyGte, qtyGt, qtyIsZero, qtyLte } from '$lib/utils/qty';

	let { open = $bindable(false), plan = null }: { open?: boolean; plan?: MealPlan | null } =
		$props();

	const balance = useStockBalance();
	const issue = useIssueRequisition();
	const gasTypes = useGasCylinderTypes();
	const gasLedger = useGasLedger();
	const itemMasters = useItemMasters(() => getShelterCode());
	const supplyItems = useSupplyItems();

	const getItemName = (id: string) => getItemDisplayName(id, itemMasters.data, supplyItems.data);

	// Check gas availability against cylinder ledger balance.
	const gasRows = $derived.by(() => {
		if (!plan?.gas_usage?.length) return [];
		return plan.gas_usage.map((g) => {
			const cyl = (gasTypes.data ?? []).find((t) => t._id === g.cylinder_id);
			const remaining = cyl
				? gasCylinderBalance(gasLedger.data ?? [], g.cylinder_id, cyl.capacity_kg)
				: '0';
			return {
				name: cyl?.name ?? g.cylinder_id,
				consumption_kg: g.consumption_kg,
				remaining,
				insufficient: qtyGt(g.consumption_kg, remaining)
			};
		});
	});
	const hasGasShortfall = $derived(gasRows.some((g) => g.insufficient));

	// Convert plan to requisition items; captures errors if mapping fails.
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
		return assessRequisition(requested.items, balance.data ?? new Map<string, string>());
	});

	// User overrides for issued quantity, keyed by plan and item ID.
	let edits = $state<Record<string, string>>({});

	// Calculate effective issued quantities clamped to issuable limits.
	const rows = $derived(
		assessment.map((a) => {
			const key = `${plan?._id ?? ''}::${a.item_id}`;
			const raw = key in edits ? edits[key] : a.qty_issuable;
			let qty: string;
			try {
				qty = persistQty(raw);
			} catch {
				qty = '0';
			}
			if (qtyLte(qty, 0)) qty = '0';
			if (qtyGt(qty, a.qty_issuable)) qty = a.qty_issuable;
			return { a, key, qty };
		})
	);

	const hasShortfall = $derived(assessment.some((a) => qtyGt(a.shortfall, 0)));
	// Gas shortfalls strictly disable issuance.
	const canIssue = $derived(rows.some((r) => qtyGt(r.qty, 0)) && !hasGasShortfall);

	const STATUS: Record<string, { label: string; class: string }> = {
		ok: { label: 'สต็อกพอ', class: 'bg-green-100 text-green-800' },
		partial: { label: 'ไม่พอ — เบิกได้บางส่วน', class: 'bg-amber-100 text-amber-800' },
		out: { label: 'ไม่มีสต็อก', class: 'bg-red-100 text-red-700' }
	};

	// Close dialog and reset edits.
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
	<Dialog.Content class="sm:max-w-2xl">
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
								{@const itemName = getItemName(r.a.item_id)}
								<Table.Row>
									<Table.Cell class="px-3">
										<div class="font-medium text-foreground">{itemName}</div>
										{#if itemName !== r.a.item_id}
											<div class="font-mono text-2xs text-muted-foreground">{r.a.item_id}</div>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-3 text-right text-sm">
										{r.a.qty_requested}
										<span class="text-xs text-muted-foreground">{r.a.unit}</span>
									</Table.Cell>
									<Table.Cell class="px-3 text-right text-sm">
										{qtyGte(r.a.on_hand, 0) ? r.a.on_hand : '0'}
										<span class="text-xs text-muted-foreground">{r.a.unit}</span>
									</Table.Cell>
									<Table.Cell class="px-3 text-center">
										<span
											class="inline-flex rounded-full px-2 py-0.5 text-2xs font-medium {STATUS[
												r.a.status
											].class}"
										>
											{STATUS[r.a.status].label}
										</span>
									</Table.Cell>
									<Table.Cell class="px-3 text-right">
										<div class="flex items-center justify-end gap-1.5">
											<Input
												type="text"
												inputmode="decimal"
												value={r.qty}
												oninput={(e) => (edits[r.key] = e.currentTarget.value)}
												class="h-8 w-24 [appearance:textfield] text-right text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
												disabled={qtyLte(r.a.qty_issuable, 0) || qtyIsZero(r.a.qty_issuable)}
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

				{#if gasRows.length > 0}
					<div class="space-y-2">
						<p class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
							<Flame class="h-3.5 w-3.5 text-orange-500" />
							แก๊สที่จะเบิก
						</p>
						<div class="overflow-x-auto rounded-md border">
							<Table.Root>
								<Table.Header>
									<Table.Row class="text-xs">
										<Table.Head class="px-3">ถังแก๊ส</Table.Head>
										<Table.Head class="px-3 text-right">ต้องใช้</Table.Head>
										<Table.Head class="px-3 text-right">เหลือ</Table.Head>
										<Table.Head class="px-3 text-center">สถานะ</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each gasRows as g (g.name)}
										<Table.Row>
											<Table.Cell class="px-3 text-sm">{g.name}</Table.Cell>
											<Table.Cell class="px-3 text-right text-sm">{g.consumption_kg} kg</Table.Cell>
											<Table.Cell class="px-3 text-right text-sm">{g.remaining} kg</Table.Cell>
											<Table.Cell class="px-3 text-center">
												<span
													class="inline-flex rounded-full px-2 py-0.5 text-2xs font-medium {g.insufficient
														? 'bg-red-100 text-red-700'
														: 'bg-green-100 text-green-800'}"
												>
													{g.insufficient ? 'ไม่พอ' : 'พอ'}
												</span>
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
						{#if hasGasShortfall}
							<div
								class="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800"
							>
								<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
								<span>
									ถังแก๊สบางใบเหลือไม่พอตามที่แผนนี้คำนวณไว้ — เบิกไม่ได้จนกว่าจะเติมแก๊สหรือแก้แผน
									ให้เลือกถังอื่น (แก๊สเบิกบางส่วนไม่ได้ ต่างจากวัตถุดิบ)
								</span>
							</div>
						{/if}
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

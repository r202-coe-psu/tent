<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Truck from '@lucide/svelte/icons/truck';
	import Send from '@lucide/svelte/icons/send';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as Table from '$lib/components/ui/table';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import {
		useMealSessions,
		useMealPlans,
		useMealServices,
		useMealServiceReceipts,
		useMealDistributionPushes,
		useCreateMealDistributionPush,
		mealServiceReceiptOutcome,
		mealServicePushRemaining,
		toMealPlanMap,
		MEAL_PERIOD_LABELS,
		type MealPlan
	} from '$lib/features/kitchen';
	import { useShelter, type Zone } from '$lib/features/shelters';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { formatThaiDate, formatThaiDateTime } from '$lib/utils/date';

	const sessions = useMealSessions();
	const plans = useMealPlans();
	const services = useMealServices();
	const receipts = useMealServiceReceipts();
	const pushes = useMealDistributionPushes();
	const createPush = useCreateMealDistributionPush();
	const shelterQuery = useShelter(() => getShelterCode());

	const planById = $derived(toMealPlanMap(plans.data));

	function planLabel(planId: string | undefined, planMap: Record<string, MealPlan>): string {
		if (!planId) return 'เมนูอาหาร';
		const plan = planMap[planId];
		return plan?.label ?? (plan ? (MEAL_PERIOD_LABELS[plan.meal] ?? 'เมนูอาหาร') : 'เมนูอาหาร');
	}

	const ALL_ZONES_VALUE = 'ALL_ZONES';

	// Real per-shelter zones (shelter_master.zones[]) — same source as the
	// evacuee zone picker — instead of free text. "ทั้งศูนย์" covers the
	// mockup's "Main Hub POS" (serves all zones at once).
	const activeZones = $derived(
		(shelterQuery.data?.zones ?? []).filter((z: Zone) => z.status !== 'closed')
	);
	const posStationOptions = $derived([
		{ value: ALL_ZONES_VALUE, label: 'จุดแจกจ่ายรวมทุกโซนในศูนย์พักพิง (Main Hub POS)' },
		...activeZones.map((z) => ({ value: z.code, label: `โซน ${z.name} (${z.code})` }))
	]);

	let posStation = $state('');
	let sessionId = $state(page.url.searchParams.get('session') ?? '');
	let dispatcher = $state('');
	let vehicle = $state('');
	let qtyByServiceId = $state<Record<string, string>>({});

	// Only meal_service confirmed into stock (CR-129/CR-131) with remaining qty > 0
	// are eligible to push — matches the "รอส่งมอบ" gate.
	const eligibleServiceRows = $derived.by(() => {
		return (services.data ?? [])
			.map((service) => {
				const receipt = (receipts.data ?? []).find((r) => r.meal_service_id === service._id);
				const confirmed = !!receipt && mealServiceReceiptOutcome(receipt) === 'confirmed';
				const remaining = confirmed
					? mealServicePushRemaining(service.actual_yield ?? 0, service._id, pushes.data ?? [])
					: 0;
				return {
					service,
					menuLabel: planLabel(service.meal_plan_id ?? undefined, planById),
					confirmed,
					remaining
				};
			})
			.filter((row) => row.confirmed && row.remaining > 0);
	});

	// Meal session picker only offers sessions that actually have something
	// pending dispatch — no point selecting one with nothing to push.
	const sessionOptions = $derived.by(() => {
		const sessionIdsWithPendingDispatch: string[] = [];
		for (const row of eligibleServiceRows) {
			const id = row.service.meal_session_id;
			if (id && !sessionIdsWithPendingDispatch.includes(id)) sessionIdsWithPendingDispatch.push(id);
		}
		return (sessions.data ?? [])
			.filter((s) => sessionIdsWithPendingDispatch.includes(s._id))
			.slice()
			.sort((a, b) => b.date.localeCompare(a.date))
			.map((s) => ({
				value: s._id,
				label: `${formatThaiDate(s.date)} · ${MEAL_PERIOD_LABELS[s.meal] ?? s.meal} — ${s.name}`
			}));
	});

	const eligibleRows = $derived(
		sessionId ? eligibleServiceRows.filter((row) => row.service.meal_session_id === sessionId) : []
	);

	const totalQty = $derived(
		eligibleRows.reduce((sum, row) => {
			const qty = Number(qtyByServiceId[row.service._id] ?? 0);
			return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
		}, 0)
	);

	// History of what's already been pushed for this session — "ส่งไปไหน กี่กล่อง".
	const pushHistory = $derived(
		sessionId
			? (pushes.data ?? [])
					.filter((p) => p.meal_session_id === sessionId)
					.flatMap((p) =>
						p.items.map((item) => ({
							key: `${p._id}:${item.meal_service_id}`,
							createdAt: p.created_at,
							posStation: p.pos_station,
							dispatcher: p.dispatcher,
							menuLabel: item.menu_label,
							qty: item.qty
						}))
					)
					.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			: []
	);

	const isLoading =
		sessions.isPending ||
		plans.isPending ||
		services.isPending ||
		receipts.isPending ||
		pushes.isPending;

	async function handleConfirm() {
		const posStationLabel = posStationOptions.find((o) => o.value === posStation)?.label;
		if (!posStationLabel) {
			toast.error('กรุณาเลือกจุดแจกจ่ายปลายทาง');
			return;
		}
		if (!sessionId) {
			toast.error('กรุณาเลือกรอบมื้ออาหาร');
			return;
		}
		if (!dispatcher.trim()) {
			toast.error('กรุณาระบุเจ้าหน้าที่ผู้จัดสรร');
			return;
		}
		const items = eligibleRows
			.map((row) => ({
				meal_service_id: row.service._id,
				menu_label: row.menuLabel,
				qty: Number(qtyByServiceId[row.service._id] ?? 0)
			}))
			.filter((item) => item.qty > 0);
		if (items.length === 0) {
			toast.error('กรุณาระบุจำนวนจัดสรรอย่างน้อย 1 รายการ');
			return;
		}
		try {
			await createPush.mutateAsync({
				input: {
					pos_station: posStationLabel,
					meal_session_id: sessionId,
					dispatcher: dispatcher.trim(),
					vehicle: vehicle.trim() || undefined,
					items
				},
				ctx: { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' }
			});
			toast.success('ยืนยันจัดสรรและออกตั๋วส่งจุดแจกแล้ว');
			qtyByServiceId = {};
			goto(resolve('/back-office/tickets/kitchen'));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'จัดสรรไม่สำเร็จ');
		}
	}
</script>

<div class="min-h-full bg-[#F8FAFC]">
	<div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
		<div class="flex items-center gap-3">
			<a
				href={resolve('/back-office/tickets/kitchen')}
				class="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
			>
				<ArrowLeft class="h-4 w-4" />
				กลับหน้ารายการ
			</a>
		</div>

		{#if !(sessionId && eligibleRows.length === 0)}
			<section class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-7">
				<h1
					class="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl"
				>
					<Truck class="h-6 w-6 text-orange-600" />
					จัดสรรอาหารปรุงเสร็จส่งจุดแจกจ่าย (Push to POS)
				</h1>
				<p class="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
					จัดสรรอาหารปรุงสำเร็จที่คลังยืนยันตรวจรับแล้วไปยังจุดแจกจ่ายหน้างาน
				</p>

				<div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<Label class="text-sm font-semibold text-slate-700"
							>จุดแจกจ่ายปลายทาง (POS Station) *</Label
						>
						<Select.Root type="single" bind:value={posStation}
							><Select.Trigger class="h-11 w-full"
								><span class="truncate"
									>{posStationOptions.find((o) => o.value === posStation)?.label ??
										'เลือกจุดแจกจ่ายปลายทาง'}</span
								></Select.Trigger
							><Select.Content
								>{#each posStationOptions as opt (opt.value)}<Select.Item
										value={opt.value}
										label={opt.label}>{opt.label}</Select.Item
									>{/each}</Select.Content
							></Select.Root
						>
					</div>
					<div class="space-y-1.5">
						<Label class="text-sm font-semibold text-slate-700">รอบมื้ออาหาร (Meal Session) *</Label
						>
						<Select.Root type="single" bind:value={sessionId}
							><Select.Trigger class="h-11 w-full"
								><span class="truncate"
									>{sessionOptions.find((o) => o.value === sessionId)?.label ??
										'เลือกรอบมื้ออาหาร'}</span
								></Select.Trigger
							><Select.Content
								>{#each sessionOptions as opt (opt.value)}<Select.Item
										value={opt.value}
										label={opt.label}>{opt.label}</Select.Item
									>{/each}</Select.Content
							></Select.Root
						>
					</div>
					<div class="space-y-1.5">
						<Label class="text-sm font-semibold text-slate-700"
							>เจ้าหน้าที่ผู้จัดสรร / ทีมลำเลียง *</Label
						>
						<Input
							bind:value={dispatcher}
							placeholder="เช่น นายสมศักดิ์ (ทีมลำเลียงเสบียง)"
							class="h-11"
						/>
					</div>
					<div class="space-y-1.5">
						<Label class="text-sm font-semibold text-slate-700">ยานพาหนะ/อุปกรณ์ขนส่ง</Label>
						<Input bind:value={vehicle} placeholder="เช่น รถกอล์ฟไฟฟ้า 02" class="h-11" />
					</div>
				</div>
			</section>

			<section class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
				<div class="border-b border-slate-200/80 p-5 sm:p-6">
					<h2 class="text-lg font-bold text-slate-900">รายการเมนูอาหารสำเร็จรูปที่จัดสรร</h2>
					<p class="mt-1 text-sm text-slate-500">
						แสดงเฉพาะเมนูที่คลังยืนยันตรวจรับเข้าสต็อกแล้วและยังมียอดคงเหลือของรอบมื้อที่เลือก
					</p>
				</div>

				<div class="overflow-x-auto">
					{#if !sessionId}
						<div class="py-12 text-center text-sm text-slate-500">
							เลือกรอบมื้ออาหารเพื่อดูรายการเมนู
						</div>
					{:else if isLoading}
						<div class="py-12 text-center text-sm text-slate-500">กำลังโหลด...</div>
					{:else if !eligibleRows.length}
						<div class="py-12 text-center text-sm text-slate-500">
							ไม่มีเมนูที่ยืนยันตรวจรับเข้าสต็อกแล้วสำหรับรอบมื้อนี้
						</div>
					{:else}
						<Table.Root
							><Table.Header
								><Table.Row class="bg-slate-50 hover:bg-slate-50"
									><Table.Head class="px-5 font-semibold text-slate-700"
										>เมนูอาหารปรุงเสร็จในคลัง</Table.Head
									><Table.Head class="font-semibold text-slate-700">คงเหลือ</Table.Head><Table.Head
										class="font-semibold text-slate-700">จำนวนจัดสรร</Table.Head
									></Table.Row
								></Table.Header
							><Table.Body>
								{#each eligibleRows as row (row.service._id)}
									<Table.Row
										><Table.Cell class="px-5 text-sm font-semibold text-slate-800"
											>{row.menuLabel}</Table.Cell
										><Table.Cell class="text-sm font-bold text-slate-700 tabular-nums"
											>{row.remaining} กล่อง</Table.Cell
										><Table.Cell
											><Input
												type="number"
												min="0"
												max={row.remaining}
												value={qtyByServiceId[row.service._id] ?? ''}
												oninput={(e) =>
													(qtyByServiceId = {
														...qtyByServiceId,
														[row.service._id]: e.currentTarget.value
													})}
												class="h-10 w-28 tabular-nums"
											/></Table.Cell
										></Table.Row
									>
								{/each}
							</Table.Body></Table.Root
						>
					{/if}
				</div>

				<div
					class="flex items-center justify-between gap-3 border-t border-slate-200/80 p-5 sm:p-6"
				>
					<Button variant="outline" onclick={() => goto(resolve('/back-office/tickets/kitchen'))}
						>ยกเลิก</Button
					>
					<div class="flex items-center gap-3">
						<span class="text-sm text-slate-600"
							>ยอดจัดสรรรวม: <span class="font-bold text-slate-900 tabular-nums">{totalQty}</span> กล่อง</span
						>
						<Button
							class="min-h-11 gap-2 bg-[#0A2647] hover:bg-[#051930]"
							disabled={createPush.isPending || totalQty === 0}
							onclick={handleConfirm}
						>
							<Send class="h-4 w-4" />
							{createPush.isPending
								? 'กำลังบันทึก...'
								: 'ยืนยันจัดสรรและออกตั๋วส่งจุดแจก (Push to POS)'}
						</Button>
					</div>
				</div>
			</section>
		{/if}

		{#if sessionId}
			<section class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
				<div class="border-b border-slate-200/80 p-5 sm:p-6">
					<h2 class="text-lg font-bold text-slate-900">ประวัติการจัดสรรส่งจุดแจกของรอบมื้อนี้</h2>
				</div>
				<div class="overflow-x-auto">
					{#if !pushHistory.length}
						<div class="py-10 text-center text-sm text-slate-500">ยังไม่มีการจัดสรรส่งจุดแจก</div>
					{:else}
						<Table.Root
							><Table.Header
								><Table.Row class="bg-slate-50 hover:bg-slate-50"
									><Table.Head class="px-5 font-semibold text-slate-700">เวลา</Table.Head
									><Table.Head class="font-semibold text-slate-700">จุดแจกจ่ายปลายทาง</Table.Head
									><Table.Head class="font-semibold text-slate-700">เมนู</Table.Head><Table.Head
										class="font-semibold text-slate-700">จำนวน</Table.Head
									><Table.Head class="px-5 font-semibold text-slate-700">ผู้จัดสรร</Table.Head
									></Table.Row
								></Table.Header
							><Table.Body>
								{#each pushHistory as row (row.key)}
									<Table.Row
										><Table.Cell class="px-5 text-sm text-slate-700"
											>{formatThaiDateTime(row.createdAt)}</Table.Cell
										><Table.Cell class="text-sm font-semibold text-slate-800"
											>{row.posStation}</Table.Cell
										><Table.Cell class="text-sm text-slate-700">{row.menuLabel}</Table.Cell
										><Table.Cell class="text-sm font-bold text-slate-800 tabular-nums"
											>{row.qty} กล่อง</Table.Cell
										><Table.Cell class="px-5 text-sm text-slate-700">{row.dispatcher}</Table.Cell
										></Table.Row
									>
								{/each}
							</Table.Body></Table.Root
						>
					{/if}
				</div>
			</section>
		{/if}
	</div>
</div>

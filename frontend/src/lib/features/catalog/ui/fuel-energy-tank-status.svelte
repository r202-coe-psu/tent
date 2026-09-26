<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleSlash from '@lucide/svelte/icons/circle-slash';
	import Flame from '@lucide/svelte/icons/flame';
	import Info from '@lucide/svelte/icons/info';
	import PlayCircle from '@lucide/svelte/icons/play-circle';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { addQty, qtyGt, subQty } from '$lib/utils/qty';
	import {
		gasCylinderBalance,
		useFuelCylinders,
		useGasLedger,
		useMealPlans,
		useMealServices,
		type FuelCylinder
	} from '$lib/features/kitchen';

	let {
		itemMasterId,
		cylinderId,
		compact = false
	}: { itemMasterId: string; cylinderId?: string; compact?: boolean } = $props();
	type TankStatus = 'available' | 'in_use' | 'unavailable';
	type GasLevel = 'full' | 'normal' | 'low' | 'empty';
	type TankRow = {
		cylinder: FuelCylinder;
		remaining: string;
		percentage: number;
		tankStatus: TankStatus;
		gasLevel: GasLevel;
	};
	const cylinders = useFuelCylinders();
	const ledger = useGasLedger();
	const mealPlans = useMealPlans();
	const mealServices = useMealServices();
	let open = $state(false);

	const row = $derived.by((): TankRow | null => {
		const cylinder = (cylinders.data ?? []).find(
			(item) => item.item_master_id === itemMasterId && (!cylinderId || item._id === cylinderId)
		);
		if (!cylinder) return null;
		const activePlans = (mealPlans.data ?? []).filter(
			(plan) =>
				plan.status === 'confirmed' &&
				!!plan.cooking_started_at &&
				!(mealServices.data ?? []).some((service) => service.meal_plan_id === plan._id)
		);
		const plannedUsage = activePlans.reduce(
			(total, plan) =>
				(plan.gas_usage ?? [])
					.filter((usage) => usage.cylinder_id === cylinder._id)
					.reduce((sum, usage) => addQty(sum, usage.consumption_kg), total),
			'0'
		);
		const ledgerRemaining = gasCylinderBalance(
			ledger.data ?? [],
			cylinder._id,
			cylinder.capacity_kg
		);
		const remaining = qtyGt(plannedUsage, ledgerRemaining)
			? '0'
			: subQty(ledgerRemaining, plannedUsage);
		const inUse = qtyGt(plannedUsage, 0);
		const capacity = Number(cylinder.capacity_kg) || 0;
		const ratio = capacity > 0 ? (Number(remaining) || 0) / capacity : 0;
		return {
			cylinder,
			remaining,
			percentage: Math.max(0, Math.min(100, Math.round(ratio * 100))),
			tankStatus: cylinder.deactivated ? 'unavailable' : inUse ? 'in_use' : 'available',
			gasLevel: ratio <= 0 ? 'empty' : ratio <= 0.2 ? 'low' : ratio >= 1 ? 'full' : 'normal'
		};
	});

	const tankMeta = {
		available: {
			label: 'ว่าง',
			className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
			icon: CircleCheck
		},
		in_use: {
			label: 'กำลังใช้',
			className: 'border-sky-200 bg-sky-50 text-sky-900',
			icon: PlayCircle
		},
		unavailable: {
			label: 'ใช้ไม่ได้',
			className: 'border-red-200 bg-red-50 text-red-900',
			icon: CircleSlash
		}
	} as const;
	const levelMeta = {
		full: { label: 'เต็ม', className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
		normal: { label: 'ปกติ', className: 'border-sky-200 bg-sky-50 text-sky-900' },
		low: { label: 'ใกล้หมด', className: 'border-amber-200 bg-amber-50 text-amber-900' },
		empty: { label: 'หมด', className: 'border-red-200 bg-red-50 text-red-900' }
	} as const;
</script>

{#if compact}
	{#if row}
		<span class="text-xs font-semibold text-emerald-700 tabular-nums">
			{row.remaining} ({row.percentage}%)
		</span>
	{:else}
		<span class="text-xs text-muted-foreground">—</span>
	{/if}
{:else}
	<Button
		variant="outline"
		size="icon"
		class="h-7 min-h-0 w-7 min-w-0 shrink-0 border-slate-200 text-slate-500 hover:bg-slate-50"
		onclick={() => (open = true)}
		aria-label="ดูข้อมูลถังแก๊ส"
		title="ดูข้อมูลถังแก๊ส"
	>
		<Info class="h-3.5 w-3.5" /><span class="sr-only">ดูข้อมูลถังแก๊ส</span>
	</Button>
{/if}

<Dialog.Root {open} onOpenChange={(value) => (open = value)}>
	<Dialog.Content class="sm:max-w-lg">
		{#if row}
			{@const tank = tankMeta[row.tankStatus]}
			{@const level = levelMeta[row.gasLevel]}
			{@const TankIcon = tank.icon}
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2"
					><Flame class="h-5 w-5 text-orange-600" />ข้อมูลถัง {row.cylinder
						.cylinder_code}</Dialog.Title
				>
				<Dialog.Description>{row.cylinder.name}</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="rounded-xl border bg-slate-50 p-4">
					<p class="text-sm text-slate-500">สถานะถัง</p>
					<Badge variant="outline" class="mt-2 gap-1.5 {tank.className}"
						><TankIcon class="h-4 w-4" />{tank.label}</Badge
					>
				</div>
				<div class="rounded-xl border bg-slate-50 p-4">
					<p class="text-sm text-slate-500">ระดับแก๊ส</p>
					<Badge variant="outline" class="mt-2 {level.className}">{level.label}</Badge>
				</div>
				<div class="rounded-xl border p-4">
					<p class="text-sm text-slate-500">คงเหลือ</p>
					<p class="mt-1 text-xl font-bold tabular-nums">
						{row.remaining} / {row.cylinder.capacity_kg} กก. ({row.percentage}%)
					</p>
				</div>
				<div class="rounded-xl border p-4">
					<p class="text-sm text-slate-500">อัตราการใช้</p>
					<p class="mt-1 text-xl font-bold tabular-nums">
						{row.cylinder.burn_rate_kg_per_hour} กก./ชม.
					</p>
				</div>
			</div>
		{:else}
			<Dialog.Header
				><Dialog.Title>ข้อมูลถังแก๊ส</Dialog.Title><Dialog.Description
					>ยังไม่พบข้อมูลถังที่ผูกกับรายการนี้</Dialog.Description
				></Dialog.Header
			>
		{/if}
	</Dialog.Content>
</Dialog.Root>

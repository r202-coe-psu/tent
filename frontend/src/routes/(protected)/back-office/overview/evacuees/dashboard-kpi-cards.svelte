<script lang="ts">
	import type { OccupancyPayload } from '$lib/features/dashboard';
	import Users from '@lucide/svelte/icons/users';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UserX from '@lucide/svelte/icons/user-x';
	import Clock from '@lucide/svelte/icons/clock';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import Home from '@lucide/svelte/icons/home';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';

	let { occupancy }: { occupancy: OccupancyPayload } = $props();

	// KPI logic — "in the shelter" is active + room_confirmed (CR-170). arriving counts toward
	// the total but not as in the shelter; pre_registered/kiosk_registered are not checked in yet.
	const returnRate = $derived(
		occupancy.total > 0 ? ((occupancy.checked_out / occupancy.total) * 100).toFixed(0) + '%' : '0%'
	);
	// Matches the combined display in system-overview (loadSiteMetrics) so this card's total
	// agrees with occupancy.total, which also sums both channels.
	const awaitingCheckIn = $derived(occupancy.pre_registered + occupancy.kiosk_registered);

	const cards = $derived([
		{ label: 'ผู้เข้าพักทั้งหมด', value: occupancy.total, icon: Users, tone: 'text-blue-500' },
		{
			label: 'อยู่ในศูนย์อพยพ',
			value: occupancy.in_shelter,
			icon: UserCheck,
			tone: 'text-green-500'
		},
		{
			label: 'รอเข้าพัก (ลงทะเบียนล่วงหน้า/ที่ตู้)',
			value: awaitingCheckIn,
			icon: Clock,
			tone: 'text-blue-400'
		},
		{
			label: 'รายงานตัวแล้ว (รอคัดกรอง/จัดที่พัก)',
			value: occupancy.arriving,
			icon: ClipboardList,
			tone: 'text-sky-500'
		},
		{
			label: 'ออกชั่วคราว',
			value: occupancy.temporary_leave,
			icon: DoorOpen,
			tone: 'text-amber-500'
		},
		{
			label: 'ย้ายไปศูนย์อพยพอื่น',
			value: occupancy.transferred,
			icon: ArrowRightLeft,
			tone: 'text-purple-500'
		},
		{
			label: 'ออกจากศูนย์อพยพแล้ว',
			value: occupancy.checked_out,
			icon: UserX,
			tone: 'text-red-500'
		},
		{ label: 'อัตรากลับบ้าน', value: returnRate, icon: Home, tone: 'text-amber-500' }
	]);
</script>

<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
	{#each cards as card (card.label)}
		<div class="min-w-0 rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-sm">
			<div class="flex items-start justify-between gap-2">
				<h3 class="text-xs leading-snug font-medium text-muted-foreground">{card.label}</h3>
				<card.icon class="h-4 w-4 shrink-0 {card.tone}" />
			</div>
			<div class="mt-1 text-xl font-bold tabular-nums">{card.value}</div>
		</div>
	{/each}
</div>

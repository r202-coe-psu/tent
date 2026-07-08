<script lang="ts">
	import type { OccupancyPayload } from '$lib/features/dashboard';
	import Users from '@lucide/svelte/icons/users';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UserX from '@lucide/svelte/icons/user-x';
	import Clock from '@lucide/svelte/icons/clock';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import Home from '@lucide/svelte/icons/home';
	import HeartCrack from '@lucide/svelte/icons/heart-crack';

	let { occupancy }: { occupancy: OccupancyPayload } = $props();

	// KPI logic — "present" follows the CR-022 headcount definition: active only
	// (pre_registered means registered but not yet physically checked in).
	const returnRate = $derived(
		occupancy.total > 0 ? ((occupancy.checked_out / occupancy.total) * 100).toFixed(0) + '%' : '0%'
	);
</script>

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
			<h3 class="text-sm font-medium tracking-tight">ผู้ประสบภัยทั้งหมด</h3>
			<Users class="h-4 w-4 text-blue-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.total}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
			<h3 class="text-sm font-medium tracking-tight">อยู่ในศูนย์อพยพ</h3>
			<UserCheck class="h-4 w-4 text-green-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.active}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
			<h3 class="text-sm font-medium tracking-tight">รอเข้าพัก (ลงทะเบียนล่วงหน้า)</h3>
			<Clock class="h-4 w-4 text-blue-400" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.pre_registered}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
			<h3 class="text-sm font-medium tracking-tight">ออกชั่วคราว</h3>
			<DoorOpen class="h-4 w-4 text-amber-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.temporary_leave}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
			<h3 class="text-sm font-medium tracking-tight">ย้ายไปศูนย์อพยพอื่น</h3>
			<ArrowRightLeft class="h-4 w-4 text-purple-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.transferred}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
			<h3 class="text-sm font-medium tracking-tight">ออกจากศูนย์อพยพแล้ว</h3>
			<UserX class="h-4 w-4 text-red-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.checked_out}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
			<h3 class="text-sm font-medium tracking-tight">อัตรากลับบ้าน</h3>
			<Home class="h-4 w-4 text-amber-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{returnRate}</div>
		</div>
	</div>
</div>

<script lang="ts">
	import type { OccupancyPayload } from '$lib/features/dashboard';
	import Users from '@lucide/svelte/icons/users';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UserX from '@lucide/svelte/icons/user-x';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import Home from '@lucide/svelte/icons/home';

	let { occupancy }: { occupancy: OccupancyPayload } = $props();

	// KPI logic
	const present = $derived(occupancy.registered + occupancy.checked_in);
	const returnRate = $derived(
		occupancy.total > 0 ? ((occupancy.checked_out / occupancy.total) * 100).toFixed(0) + '%' : '0%'
	);
</script>

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
			<h3 class="tracking-tight text-sm font-medium">ผู้ประสบภัยทั้งหมด</h3>
			<Users class="h-4 w-4 text-blue-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.total}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
			<h3 class="tracking-tight text-sm font-medium">ยังอยู่</h3>
			<UserCheck class="h-4 w-4 text-green-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{present}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
			<h3 class="tracking-tight text-sm font-medium">ออกไปแล้ว</h3>
			<UserX class="h-4 w-4 text-red-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.checked_out}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
			<h3 class="tracking-tight text-sm font-medium">ย้าย</h3>
			<ArrowRightLeft class="h-4 w-4 text-purple-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{occupancy.transferred}</div>
		</div>
	</div>

	<div class="rounded-xl border bg-card text-card-foreground shadow-sm">
		<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
			<h3 class="tracking-tight text-sm font-medium">อัตราคืนบ้าน</h3>
			<Home class="h-4 w-4 text-amber-500" />
		</div>
		<div class="p-6 pt-0">
			<div class="text-2xl font-bold">{returnRate}</div>
		</div>
	</div>
</div>

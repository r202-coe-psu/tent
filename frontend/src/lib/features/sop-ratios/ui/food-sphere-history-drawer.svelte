<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Clock from '@lucide/svelte/icons/clock';
	import User from '@lucide/svelte/icons/user';
	import { fade, fly } from 'svelte/transition';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { getSourceLabel } from '$lib/utils/source';
	import type { FoodSphereStandard } from '../domain/food-sphere';

	interface Props {
		standard: FoodSphereStandard;
		onClose: () => void;
	}

	const { standard, onClose }: Props = $props();
</script>

<!-- Backdrop -->
<div
	transition:fade={{ duration: 150 }}
	class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
	role="presentation"
	onclick={onClose}
></div>

<!-- Drawer from right -->
<div
	transition:fly={{ x: 380, duration: 200 }}
	class="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-xl"
	role="dialog"
	aria-modal="true"
	aria-labelledby="history-drawer-title"
>
	<!-- Header -->
	<div class="flex items-center justify-between border-b p-4">
		<div>
			<h2 id="history-drawer-title" class="text-base font-semibold">ประวัติและการแก้ไข</h2>
			<p class="font-mono text-xs text-muted-foreground">{standard._id}</p>
		</div>
		<button
			type="button"
			class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
			onclick={onClose}
			aria-label="ปิด"
		>
			<X class="h-4 w-4" />
		</button>
	</div>

	<!-- Content -->
	<div class="flex-1 space-y-4 overflow-y-auto p-4">
		<div class="rounded-lg border p-4">
			<div class="flex items-center justify-between text-xs text-muted-foreground">
				<span class="flex items-center gap-1">
					<Clock class="h-3.5 w-3.5" />
					{formatThaiDateTime(standard.updated_at ?? standard.created_at)}
				</span>
				<span class="flex items-center gap-1 font-mono">
					<User class="h-3.5 w-3.5" />
					{standard.created_by}
				</span>
			</div>
			<div class="mt-3 space-y-1 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">กลุ่มเป้าหมาย:</span>
					<span class="font-medium">{standard.target_segment}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">กลุ่มสารอาหาร:</span>
					<span class="font-mono font-medium">{standard.req_group_id}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">ปริมาณความต้องการ:</span>
					<span class="font-mono font-semibold">{standard.daily_demand.toLocaleString()}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">วันที่มีผลบังคับใช้:</span>
					<span class="font-medium">{standard.effective_date}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">แหล่งที่มา:</span>
					<span class="font-medium">{getSourceLabel(standard.source)}</span>
				</div>
			</div>
		</div>
	</div>
</div>

<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import * as Card from '$lib/components/ui/card/index.js';

	let { totalCount, operationalCount, controlledCount, activeCount } = $props<{
		totalCount: number;
		operationalCount: number;
		controlledCount: number;
		activeCount: number;
	}>();
</script>

<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
	<Card.Root class="rounded-2xl border-border bg-card p-4 shadow-xs">
		<div class="flex items-center justify-between text-xs font-medium text-muted-foreground">
			<span>ทักษะทั้งหมด</span>
			<span class="rounded-full bg-muted p-1 text-muted-foreground">
				<Users class="h-3.5 w-3.5" />
			</span>
		</div>
		<p class="mt-2 text-2xl font-black text-foreground">{totalCount}</p>
		<p class="mt-0.5 text-3xs text-muted-foreground">รายการใน Master Data</p>
	</Card.Root>

	<Card.Root class="rounded-2xl border-border bg-card p-4 shadow-xs">
		<div class="flex items-center justify-between text-xs font-medium text-muted-foreground">
			<span>ทักษะทั่วไป</span>
			<span class="rounded-full bg-success/15 p-1 text-success">
				<Sparkles class="h-3.5 w-3.5" />
			</span>
		</div>
		<p class="mt-2 text-2xl font-black text-success">{operationalCount}</p>
		<p class="mt-0.5 text-3xs text-muted-foreground">อนุมัติอัตโนมัติ (Auto-Approve)</p>
	</Card.Root>

	<Card.Root class="rounded-2xl border-border bg-card p-4 shadow-xs">
		<div class="flex items-center justify-between text-xs font-medium text-muted-foreground">
			<span>ทักษะควบคุม</span>
			<span class="rounded-full bg-warning/15 p-1 text-warning-foreground">
				<ShieldAlert class="h-3.5 w-3.5" />
			</span>
		</div>
		<p class="mt-2 text-2xl font-black text-warning-foreground">{controlledCount}</p>
		<p class="mt-0.5 text-3xs text-muted-foreground">ต้องตรวจสอบคุณสมบัติก่อน</p>
	</Card.Root>

	<Card.Root class="rounded-2xl border-border bg-card p-4 shadow-xs">
		<div class="flex items-center justify-between text-xs font-medium text-muted-foreground">
			<span>เปิดใช้งาน</span>
			<span class="rounded-full bg-primary/10 p-1 text-primary">
				<CheckCircle2 class="h-3.5 w-3.5" />
			</span>
		</div>
		<p class="mt-2 text-2xl font-black text-primary">{activeCount}</p>
		<p class="mt-0.5 text-3xs text-muted-foreground">พร้อมแสดงในฟอร์มรับสมัคร</p>
	</Card.Root>
</div>

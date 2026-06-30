<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import type { Evacuee } from '$lib/features/people';

	let { evacuee }: { evacuee: Evacuee } = $props();
</script>

<div
	class="space-y-4 rounded-3xl border border-amber-100 bg-amber-50/40 p-6 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/10"
>
	<div class="flex items-center gap-2.5 border-b border-amber-200/50 pb-2 dark:border-amber-900/20">
		<ShieldAlert class="size-4.5 text-amber-600 dark:text-amber-500" />
		<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">ข้อมูลติดต่อฉุกเฉิน</h3>
	</div>
	<div class="space-y-3.5">
		<div>
			<span class="block text-xs font-medium text-muted-foreground">ญาติ / ผู้ติดต่อ:</span>
			<span class="mt-0.5 block text-sm font-bold text-slate-800 dark:text-slate-200">
				{evacuee.emergency_contact?.name || 'ไม่ระบุบุคคล'}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">เบอร์โทรศัพท์ฉุกเฉิน:</span>
			<span
				class="mt-0.5 block text-sm font-bold {evacuee.emergency_contact?.phone
					? 'text-slate-800 dark:text-slate-200'
					: 'font-semibold text-red-500 dark:text-red-400'}"
			>
				{evacuee.emergency_contact?.phone || 'ไม่ระบุ'}
			</span>
		</div>
	</div>
</div>

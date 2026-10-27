<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { ScannerDevice } from '../domain/scanner.schema';

	let { device }: { device: Pick<ScannerDevice, 'staff_pin_set' | 'staff_pin_is_default'> } =
		$props();
</script>

{#if !device.staff_pin_set}
	<span class="badge-muted">
		<CircleDashed class="h-3.5 w-3.5" />
		ยังไม่ตั้ง PIN
	</span>
{:else if device.staff_pin_is_default}
	<span class="badge-warning-advisory">
		<TriangleAlert class="h-3.5 w-3.5" />
		PIN เริ่มต้น
	</span>
{:else}
	<span
		class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
	>
		<CircleCheck class="h-3.5 w-3.5" />
		ตั้ง PIN แล้ว
	</span>
{/if}

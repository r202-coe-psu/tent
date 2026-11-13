<script lang="ts">
	import Ban from '@lucide/svelte/icons/ban';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Clock from '@lucide/svelte/icons/clock';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Truck from '@lucide/svelte/icons/truck';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { withdrawalStatusMeta } from '../domain/central-warehouse.schema';
	import { M6_TONE_BADGE } from './central-warehouse.ui';

	let { status }: { status: string } = $props();

	const meta = $derived(withdrawalStatusMeta(status));
	const icons = {
		pending: Clock,
		approved: CircleCheck,
		partially_approved: CircleCheck,
		in_transit: Truck,
		issued: TriangleAlert,
		received: PackageCheck,
		rejected: CircleX,
		cancelled: Ban
	} as const;
	const Icon = $derived(icons[status as keyof typeof icons] ?? Clock);
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold {M6_TONE_BADGE[
		meta.tone
	]}"
>
	<Icon class="h-3.5 w-3.5" aria-hidden="true" />
	{meta.label}
</span>

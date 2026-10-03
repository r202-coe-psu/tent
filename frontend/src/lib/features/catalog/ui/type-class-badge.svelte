<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
	import Wrench from '@lucide/svelte/icons/wrench';
	import type { TypeClass } from '../domain/catalog';

	let {
		value,
		variant = 'full'
	}: {
		value: TypeClass | undefined | null;
		variant?: 'full' | 'compact';
	} = $props();

	const CLASS_META: Record<TypeClass, { label: string; icon: typeof Package; badgeClass: string }> =
		{
			CONSUMABLE: { label: 'วัสดุสิ้นเปลือง', icon: Package, badgeClass: 'badge-inventory' },
			DURABLE: { label: 'สิ่งของคงทน', icon: RefreshCcw, badgeClass: 'badge-warning-advisory' },
			EQUIPMENT: {
				label: 'อุปกรณ์/ครุภัณฑ์',
				icon: Wrench,
				badgeClass:
					'inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-900 dark:border-purple-900/40 dark:bg-purple-950/40 dark:text-purple-300'
			}
		};

	const resolved = $derived(value ?? 'CONSUMABLE');
	const meta = $derived(CLASS_META[resolved]);
</script>

<span class={meta.badgeClass}>
	<meta.icon class="size-3.5" />
	{#if variant === 'full'}
		{meta.label} ({resolved})
	{:else}
		{resolved}
	{/if}
</span>

<script lang="ts">
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';

	let { collapsed, onToggle }: { collapsed: boolean; onToggle: () => void } = $props();

	const label = $derived(collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู');
</script>

<button
	type="button"
	class="flex size-11 shrink-0 items-center justify-center rounded-xl border border-sidebar-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
	onclick={onToggle}
	aria-label={label}
	aria-expanded={!collapsed}
	title={label}
>
	{#if collapsed}
		<PanelLeftOpen class="size-5" />
	{:else}
		<PanelLeftClose class="size-5" />
	{/if}
</button>

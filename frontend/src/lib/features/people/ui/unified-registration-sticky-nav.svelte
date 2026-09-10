<script lang="ts">
	import type { Component } from 'svelte';

	export type UnifiedFormNavItem = {
		id: string;
		label: string;
		icon: Component<{ class?: string }>;
	};

	let {
		sections,
		activeSection,
		ariaLabel,
		onNavigate
	}: {
		sections: UnifiedFormNavItem[];
		activeSection: string;
		ariaLabel: string;
		onNavigate: (id: string) => void;
	} = $props();
</script>

<nav class="sticky-section-nav" aria-label={ariaLabel}>
	{#each sections as section (section.id)}
		{@const Icon = section.icon}
		<button
			type="button"
			class="touch-target shrink-0 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors {activeSection ===
			section.id
				? 'border-primary bg-primary-muted text-foreground'
				: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
			aria-current={activeSection === section.id ? 'location' : undefined}
			onclick={() => onNavigate(section.id)}
		>
			<Icon class="mr-1.5 inline size-4" />
			{section.label}
		</button>
	{/each}
</nav>

<script lang="ts">
	import type { Component } from 'svelte';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

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

	const activeNavItem = $derived(
		sections.find((section) => section.id === activeSection) ?? sections[0]
	);
</script>

<nav aria-label={ariaLabel}>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			aria-label={ariaLabel}
			class="touch-target flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-2xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			{#if activeNavItem}
				{@const ActiveIcon = activeNavItem.icon}
				<ActiveIcon class="size-4 shrink-0" />
				<span class="min-w-0 flex-1 truncate text-left">{activeNavItem.label}</span>
			{/if}
			<ChevronUp class="size-4 shrink-0 text-muted-foreground" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content side="top" align="start" class="w-(--bits-floating-anchor-width) min-w-56">
			<DropdownMenu.RadioGroup
				value={activeSection}
				onValueChange={(id) => {
					if (id) onNavigate(id);
				}}
			>
				{#each sections as section (section.id)}
					{@const Icon = section.icon}
					<DropdownMenu.RadioItem
						value={section.id}
						class="touch-target min-h-11 cursor-pointer gap-2 py-2.5 text-sm font-semibold"
					>
						<Icon class="size-4 shrink-0" />
						{section.label}
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</nav>

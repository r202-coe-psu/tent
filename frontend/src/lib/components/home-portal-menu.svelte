<script lang="ts">
	import { goto } from '$app/navigation';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';

	export interface MenuLink {
		label: string;
		href: string;
	}

	interface Props {
		label: string;
		items: MenuLink[];
	}

	let { label, items }: Props = $props();

	function navigate(href: string): void {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- href is pre-resolved by the caller (typed route pattern)
		void goto(href);
	}
</script>

<DropdownMenu>
	<DropdownMenuTrigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm">
				{label}
				<ChevronDown class="size-4" />
			</Button>
		{/snippet}
	</DropdownMenuTrigger>
	<DropdownMenuContent align="start">
		<DropdownMenuLabel>{label}</DropdownMenuLabel>
		{#each items as item (item.href)}
			<DropdownMenuItem onSelect={() => navigate(item.href)}>
				{item.label}
			</DropdownMenuItem>
		{/each}
	</DropdownMenuContent>
</DropdownMenu>

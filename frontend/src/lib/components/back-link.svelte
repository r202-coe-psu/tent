<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils/shadcn.js';
	import { isSameDestination, safeInternalPath } from './back-link';

	let {
		href,
		label,
		restore = true,
		fromParam = true,
		class: className
	}: {
		href: string;
		label: string;
		restore?: boolean;
		fromParam?: boolean;
		class?: string;
	} = $props();

	const destination = $derived(
		(fromParam ? safeInternalPath(page.url.searchParams.get('from')) : null) ?? href
	);

	let cameFrom = $state<string | null>(null);
	afterNavigate(({ from }) => {
		cameFrom = from?.url?.pathname ?? null;
	});

	const restoresPreviousPage = $derived(restore && isSameDestination(cameFrom, destination));

	function onclick(event: MouseEvent) {
		if (!restoresPreviousPage) return;
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		history.back();
	}
</script>

<Button
	variant="ghost"
	href={destination}
	{onclick}
	data-back-link=""
	class={cn('min-h-11 gap-2 self-start px-3 md:min-h-12', className)}
>
	<ArrowLeft aria-hidden="true" />
	{label}
</Button>

<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { isSensitiveScope, scopeShortLabel } from '../domain/third-party-client';

	let { scopes }: { scopes: string[] } = $props();
</script>

<div class="flex flex-wrap gap-1.5">
	{#each scopes as scope (scope)}
		{#if isSensitiveScope(scope)}
			<Badge
				variant="outline"
				class="h-auto gap-1 overflow-visible border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold whitespace-normal text-amber-900"
			>
				<ShieldAlert class="text-amber-700" aria-hidden="true" />
				{scopeShortLabel(scope)}
			</Badge>
		{:else}
			<Badge
				variant="outline"
				class="h-auto overflow-visible border-slate-200 bg-white px-2 py-1 text-xs font-medium whitespace-normal text-slate-700"
			>
				{scopeShortLabel(scope)}
			</Badge>
		{/if}
	{/each}
</div>

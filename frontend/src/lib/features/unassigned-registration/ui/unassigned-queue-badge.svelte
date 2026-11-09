<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	import { langState } from '$lib/states/i18n.svelte';

	import { unassignedSearchCopyByLanguage } from '../domain/search';

	/** `compact` = table cell `[คิวกลาง]`; default = dialog full label. */
	let { compact = false }: { compact?: boolean } = $props();

	const copy = $derived(unassignedSearchCopyByLanguage[langState.current]);
</script>

{#if compact}
	<Badge
		variant="outline"
		class="border-sky-300 bg-sky-50 font-normal text-sky-900"
		title={`[${copy.badgeLabel}]`}
	>
		[{copy.badgeShort}]
	</Badge>
{:else}
	<Badge variant="outline" class="border-sky-300 bg-sky-50 font-normal text-sky-900">
		[{copy.badgeLabel}]
	</Badge>
{/if}

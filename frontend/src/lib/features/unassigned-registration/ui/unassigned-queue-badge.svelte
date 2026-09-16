<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	import {
		UNASSIGNED_QUEUE_BADGE_LABEL,
		UNASSIGNED_QUEUE_BADGE_SHORT
	} from '../application/queries';

	/** `compact` = table cell `[คิวกลาง]`; default = dialog full label. */
	let { compact = false }: { compact?: boolean } = $props();
</script>

{#if compact}
	<Badge
		variant="outline"
		class="border-sky-300 bg-sky-50 font-normal text-sky-900"
		title={`[${UNASSIGNED_QUEUE_BADGE_LABEL}]`}
	>
		[{UNASSIGNED_QUEUE_BADGE_SHORT}]
	</Badge>
{:else}
	<Badge variant="outline" class="border-sky-300 bg-sky-50 font-normal text-sky-900">
		[{UNASSIGNED_QUEUE_BADGE_LABEL}]
	</Badge>
{/if}

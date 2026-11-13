<script lang="ts">
	import { getPreRegStatusInfo, type PreRegistrationListItem } from '../domain';

	let { item }: { item: PreRegistrationListItem } = $props();

	const status = $derived(
		getPreRegStatusInfo(item.stay_status, item.queue_status, !!item.shelter_code)
	);
</script>

<span
	class={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${status.className}`}
	title={status.description}
>
	<span class={`size-1.5 rounded-full ${status.dotColor}`}></span>
	{status.label}
</span>

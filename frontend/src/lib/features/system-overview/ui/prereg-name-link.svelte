<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PreRegistrationListItem } from '../domain';

	let { item }: { item: PreRegistrationListItem } = $props();
</script>

<a
	href={resolve(item.profile_href as '/system-management/pre-registrations')}
	class="font-medium break-words text-[#0284C7] hover:underline"
>
	{item.display_name}
</a>

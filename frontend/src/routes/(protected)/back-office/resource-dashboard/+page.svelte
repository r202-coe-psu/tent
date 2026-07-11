<script lang="ts">
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterCodeFromRoles } from '$lib/auth/roles';
	import { ResourceDashboard } from '$lib/features/sop-ratios/components';

	const roles = $derived(authStore.user?.roles ?? []);
	const shelterCode = $derived(shelterCodeFromRoles(roles));
</script>

<ResourceDashboard {shelterCode} />

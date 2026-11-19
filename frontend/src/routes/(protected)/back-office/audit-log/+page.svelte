<script lang="ts">
	import { AuditLogView } from '$lib/features/audit-log';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin } from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';

	const isSA = $derived(isSystemAdmin(authStore.user?.roles ?? []));
	const shelterCode = $derived(getShelterCode());
</script>

<svelte:head>
	<title>บันทึกการใช้งาน | SmartShelter Thailand</title>
</svelte:head>

<AuditLogView isSystemAdmin={isSA} {shelterCode} />

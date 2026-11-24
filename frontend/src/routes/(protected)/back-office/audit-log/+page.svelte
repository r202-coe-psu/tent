<script lang="ts">
	import { AuditLogView } from '$lib/features/audit-log';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, managerShelterCodes } from '$lib/auth/roles';
	import { resolveShelterCode } from '$lib/db/shelter';

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const managed = $derived(managerShelterCodes(roles));
	const selected = $derived(resolveShelterCode());
	const shelterCode = $derived(
		isSA ? null : selected && managed.includes(selected) ? selected : (managed[0] ?? null)
	);
</script>

<svelte:head>
	<title>บันทึกการใช้งาน | SmartShelter Thailand</title>
</svelte:head>

<AuditLogView isSystemAdmin={isSA} {shelterCode} />

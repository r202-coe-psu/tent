<script lang="ts">
	import { UserCreatePage } from '$lib/features/users';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterCodeFromRoles } from '$lib/auth/roles';

	const roles = $derived(authStore.user?.roles ?? []);
	const lockedShelterCode = $derived(
		shelterStore.selectedShelterCode ?? shelterCodeFromRoles(roles) ?? undefined
	);
</script>

{#if lockedShelterCode}
	<UserCreatePage {lockedShelterCode} backHref="/back-office/users" />
{:else}
	<div class="container mx-auto max-w-[1200px] p-4 text-sm text-muted-foreground sm:p-6">
		กำลังเลือกศูนย์พักพิง...
	</div>
{/if}

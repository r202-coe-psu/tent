<script lang="ts">
	import { resolve } from '$app/paths';
	import { RegistrationConfigPage, SHELTER_MASTER_TYPES } from '$lib/features/master-data';
</script>

<RegistrationConfigPage
	allowedTypes={SHELTER_MASTER_TYPES}
	basePath={resolve('/back-office/shelter-config')}
/>

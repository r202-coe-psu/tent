<script lang="ts">
	import { resolve } from '$app/paths';
	import { RegistrationConfigPage, HOUSEHOLD_MASTER_TYPES } from '$lib/features/master-data';
</script>

<RegistrationConfigPage
	allowedTypes={HOUSEHOLD_MASTER_TYPES}
	basePath={resolve('/back-office/household-master-data')}
/>

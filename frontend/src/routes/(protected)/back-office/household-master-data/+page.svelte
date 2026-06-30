<script lang="ts">
	import { resolve } from '$app/paths';
	import { RegistrationConfigPage } from '$lib/features/master-data';
</script>

<RegistrationConfigPage
	allowedTypes={['municipality_zone', 'community']}
	basePath={resolve('/back-office/household-master-data')}
/>

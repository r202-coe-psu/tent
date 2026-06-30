<script lang="ts">
	import { resolve } from '$app/paths';
	import { RegistrationConfigPage } from '$lib/features/master-data';
</script>

<RegistrationConfigPage
	allowedTypes={['shelter_type']}
	basePath={resolve('/back-office/shelter-config')}
/>

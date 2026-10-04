<script lang="ts">
	import { resolve } from '$app/paths';
	import { ShelterFormPage } from '$lib/features/shelters';

	let { data } = $props();
</script>

<ShelterFormPage
	id={data.id ?? ''}
	isEdit={data.mode === 'edit'}
	basePath={resolve('/system-management/shelters')}
	siteKind={data.siteKind}
/>

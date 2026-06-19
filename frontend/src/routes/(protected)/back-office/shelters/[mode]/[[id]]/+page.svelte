<script lang="ts">
	import { ShelterFormPage } from '$lib/features/shelters';

	let { data } = $props();
</script>

<ShelterFormPage id={data.id ?? ''} isEdit={data.mode === 'edit'} />

<script lang="ts">
	import { HouseholdFormPage } from '$lib/features/people';

	let { data } = $props();
</script>

<HouseholdFormPage id={data.id ?? ''} isEdit={data.mode === 'edit'} />

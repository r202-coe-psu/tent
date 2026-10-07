<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter } from '../domain/schema';
	import ZonesFacilitiesSection from './zones-facilities-section.svelte';

	let {
		form,
		formData,
		shelterCode = '',
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		shelterCode?: string;
		disabled?: boolean;
	} = $props();
</script>

<ZonesFacilitiesSection {form} {formData} {shelterCode} {disabled} />

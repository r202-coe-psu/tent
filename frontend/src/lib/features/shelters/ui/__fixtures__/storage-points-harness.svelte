<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { shelterSchema, type SubStorageItem } from '../../domain/schema';
	import StoragePointsSection from '../storage-points-section.svelte';

	/** Test-only parent: owns the shelter superForm and echoes the stored `types`. */
	let { points }: { points: SubStorageItem[] } = $props();

	const initial = defaults(zod4(shelterSchema));
	// svelte-ignore state_referenced_locally
	initial.data.common_areas = { ...initial.data.common_areas, sub_storage: points };
	const form = superForm(initial, { SPA: true, dataType: 'json' });
	const { form: formData } = form;
</script>

<StoragePointsSection {form} {formData} />
<output data-testid="types">
	{JSON.stringify(($formData.common_areas.sub_storage ?? []).map((p) => p.types))}
</output>
<output data-testid="points">{JSON.stringify($formData.common_areas.sub_storage ?? [])}</output>

<script lang="ts">
	import { fromAction } from 'svelte/attachments';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { shelterSchema, type SubStorageItem } from '../../domain/schema';
	import StoragePointsSection from '../storage-points-section.svelte';

	/**
	 * Test-only parent: owns the shelter superForm and echoes the stored `types`.
	 * `validated` wires it like `shelter-form-page.svelte` — client validators, a valid shelter and
	 * `<form>` with its `enhance` — since superforms writes the parsed data back only on a valid form (#1054).
	 */
	let { points, validated = false }: { points: SubStorageItem[]; validated?: boolean } = $props();

	const initial = defaults(zod4(shelterSchema));
	// svelte-ignore state_referenced_locally
	initial.data.common_areas = { ...initial.data.common_areas, sub_storage: points };
	// svelte-ignore state_referenced_locally
	if (validated) {
		initial.data = {
			...initial.data,
			name: 'โรงเรียนบ้านค่าย',
			site_kind: 'evacuation_center',
			operation_status: 'standby',
			capacity: 150
		};
	}
	// svelte-ignore state_referenced_locally
	const form = superForm(initial, {
		SPA: true,
		dataType: 'json',
		...(validated ? { validators: zod4(shelterSchema) } : {})
	});
	const { form: formData, enhance } = form;
</script>

<form method="POST" {@attach fromAction(enhance)}>
	<StoragePointsSection {form} {formData} />
</form>
<output data-testid="types">
	{JSON.stringify(($formData.common_areas.sub_storage ?? []).map((p) => p.types))}
</output>
<output data-testid="points">{JSON.stringify($formData.common_areas.sub_storage ?? [])}</output>

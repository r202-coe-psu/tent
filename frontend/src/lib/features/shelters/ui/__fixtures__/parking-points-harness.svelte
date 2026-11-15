<script lang="ts">
	import { fromAction } from 'svelte/attachments';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { shelterSchema, type ParkingPoint } from '../../domain/schema';
	import ParkingPointsSection from '../parking-points-section.svelte';

	/**
	 * Test-only parent: owns the shelter superForm and echoes the stored `parking_points`.
	 * Client validators + a valid shelter, as on the shelter page, so the name error shows.
	 */
	let { points }: { points: ParkingPoint[] } = $props();

	const initial = defaults(zod4(shelterSchema));
	// svelte-ignore state_referenced_locally
	initial.data.parking_points = points;
	initial.data = {
		...initial.data,
		name: 'โรงเรียนบ้านค่าย',
		site_kind: 'evacuation_center',
		operation_status: 'standby',
		capacity: 150
	};
	const form = superForm(initial, {
		SPA: true,
		dataType: 'json',
		validators: zod4(shelterSchema)
	});
	const { form: formData, enhance } = form;
</script>

<form method="POST" {@attach fromAction(enhance)}>
	<ParkingPointsSection {form} {formData} />
</form>
<output data-testid="points">{JSON.stringify($formData.parking_points ?? [])}</output>

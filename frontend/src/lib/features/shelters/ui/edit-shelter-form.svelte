<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { updateShelterSchema, type UpdateShelterInput } from '../domain/schema';
	import type { ShelterSummary } from '../data/shelters.api';

	let {
		initial,
		onsubmit,
		oncancel,
		pending = false
	}: {
		initial: ShelterSummary;
		onsubmit: (input: UpdateShelterInput) => void;
		oncancel: () => void;
		pending?: boolean;
	} = $props();

	const form = superForm(defaults(zod4(updateShelterSchema)), {
		SPA: true,
		validators: zod4(updateShelterSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			onsubmit(form.data);
		}
	});

	const { form: formData, submitting } = form;

	// Sync form values from initial prop on mount
	$effect(() => {
		form.form.set({
			name: initial.name,
			capacity: initial.capacity,
			zones: [],
			items: [],
			rules: [],
			sops: []
		});
	});
</script>

<form method="POST" use:form.enhance>
	<Field.FieldGroup>
		<Form.Field {form} name="name">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ชื่อศูนย์พักพิง</Form.Label>
					<Input {...props} bind:value={$formData.name} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="capacity">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ความจุสูงสุด (คน)</Form.Label>
					<Input {...props} type="number" bind:value={$formData.capacity} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={oncancel}>ยกเลิก</Button>
			<Form.Button disabled={$submitting || pending}>บันทึกข้อมูลศูนย์</Form.Button>
		</div>
	</Field.FieldGroup>
</form>

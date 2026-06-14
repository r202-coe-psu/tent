<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { createShelterSchema, type CreateShelterInput } from '../domain/schema';

	let {
		onsubmit,
		pending = false
	}: { onsubmit: (input: CreateShelterInput) => void; pending?: boolean } = $props();

	const form = superForm(defaults(zod4(createShelterSchema)), {
		SPA: true,
		validators: zod4(createShelterSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			onsubmit(form.data);
			reset();
		}
	});

	const { form: formData, submitting, reset } = form;
</script>

<form method="POST" use:form.enhance>
	<Field.FieldGroup>
		<Form.Field {form} name="name">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Name</Form.Label>
					<Input {...props} placeholder="e.g. Main Evacuation Center" bind:value={$formData.name} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Button disabled={$submitting || pending}>Create shelter</Form.Button>
	</Field.FieldGroup>
</form>

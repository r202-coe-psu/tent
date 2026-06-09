<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { createUserSchema } from '../domain/schema';

	let {
		onsubmit,
		pending = false
	}: { onsubmit: (data: { name: string; password: string }) => void; pending?: boolean } = $props();

	const form = superForm(defaults(zod4(createUserSchema)), {
		SPA: true,
		validators: zod4(createUserSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			onsubmit({ name: form.data.username, password: form.data.password });
			reset();
		}
	});

	const { form: formData, submitting, reset } = form;
</script>

<form method="POST" use:form.enhance>
	<Field.FieldGroup>
		<Form.Field {form} name="username">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Username</Form.Label>
					<Input {...props} bind:value={$formData.username} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
		<Form.Field {form} name="password">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Password</Form.Label>
					<Input {...props} type="password" bind:value={$formData.password} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
		<Form.Button disabled={$submitting || pending}>Create User</Form.Button>
	</Field.FieldGroup>
</form>

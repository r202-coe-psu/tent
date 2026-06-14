<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { evacueeInputSchema, type EvacueeInput } from '../domain/people';

	let {
		onsubmit,
		pending = false
	}: { onsubmit: (input: EvacueeInput) => void; pending?: boolean } = $props();

	// "ไม่มี" — when checked, the evacuee has no phone (schema nullable → null).
	let noPhone = $state(false);

	const form = superForm(defaults(zod4(evacueeInputSchema)), {
		SPA: true,
		validators: zod4(evacueeInputSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			onsubmit(form.data);
			noPhone = false;
			reset();
		}
	});

	const { form: formData, submitting, reset } = form;

	// Reuse the one schema (ชิ้น 1) — the UI never re-implements validation.
	// Toggling "no phone" clears the field to null so the nullable phone passes.
	$effect(() => {
		if (noPhone) $formData.phone = null;
	});
</script>

<form method="POST" use:form.enhance>
	<Field.FieldGroup>
		<Form.Field {form} name="first_name">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>First name</Form.Label>
					<Input {...props} bind:value={$formData.first_name} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="last_name">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Last name</Form.Label>
					<Input {...props} bind:value={$formData.last_name} />
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="gender">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Gender</Form.Label>
					<select
						{...props}
						bind:value={$formData.gender}
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					>
						<option value="male">Male</option>
						<option value="female">Female</option>
						<option value="other">Other</option>
					</select>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="phone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Phone</Form.Label>
					<Input
						{...props}
						inputmode="numeric"
						placeholder="0812345678"
						disabled={noPhone}
						value={$formData.phone ?? ''}
						oninput={(e) => ($formData.phone = e.currentTarget.value)}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Field.Field orientation="horizontal">
			<Checkbox id="no-phone" bind:checked={noPhone} />
			<Field.Label for="no-phone">ไม่มี (no phone)</Field.Label>
		</Field.Field>

		<Form.Button disabled={$submitting || pending}>Register evacuee</Form.Button>
	</Field.FieldGroup>
</form>

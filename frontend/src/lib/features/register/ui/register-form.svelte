<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { registerSchema } from '../domain/schema';
	import { registerUser } from '../data/register.api';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';

	const form = superForm(defaults(zod4(registerSchema)), {
		SPA: true,
		validators: zod4(registerSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) {
				toast.error('Form not valid. Please check the fields.');
				return;
			}

			if (form.data.password !== form.data.confirmPassword) {
				toast.error("Passwords don't match");
				return;
			}

			await toast.promise(
				(async () => {
					await registerUser(form.data.username, form.data.password);
					await authStore.login({
						name: form.data.username,
						password: form.data.password
					});
					reset();
					await goto(resolve('/notes'));
				})(),
				{
					loading: 'Creating account...',
					success: 'Account created successfully!',
					error: (err) => (err instanceof Error ? err.message : 'Registration failed')
				}
			);
		}
	});
	const { form: formData, submitting, reset } = form;
</script>

<Card.Root class="mx-auto w-full max-w-sm">
	<Card.Header>
		<Card.Title class="text-2xl">Create Account</Card.Title>
		<Card.Description>Fill in the details below to create your account</Card.Description>
	</Card.Header>
	<Card.Content>
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
							<Input
								{...props}
								type="password"
								bind:value={$formData.password}
								placeholder="Enter your password"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="confirmPassword">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Confirm Password</Form.Label>
							<Input
								{...props}
								type="password"
								bind:value={$formData.confirmPassword}
								placeholder="Confirm your password"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Button disabled={$submitting}>Register</Form.Button>
			</Field.FieldGroup>
		</form>
		<p class="mt-4 text-center text-sm text-muted-foreground">
			Already have an account?
			<a href={resolve('/login')} class="underline underline-offset-4 hover:text-primary">
				Login
			</a>
		</p>
	</Card.Content>
</Card.Root>

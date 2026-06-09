<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { loginSchema } from '../domain/schema';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';

	const form = superForm(defaults(zod4(loginSchema)), {
		SPA: true,
		validators: zod4(loginSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) {
				toast.error('Form not valid. Please check the fields.');
				return;
			}

			await toast.promise(
				(async () => {
					await authStore.login({
						name: form.data.username,
						password: form.data.password
					});
					reset();
					await goto(resolve('/notes'));
				})(),
				{
					loading: 'Logging in...',
					success: 'Login successful!',
					error: (err) => (err instanceof Error ? err.message : 'Login failed')
				}
			);
		}
	});
	const { form: formData, submitting, reset } = form;
</script>

<Card.Root class="mx-auto w-full max-w-sm">
	<Card.Header>
		<Card.Title class="text-2xl">Login</Card.Title>
		<Card.Description>Enter your credentials to access your account</Card.Description>
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
				<Form.Button disabled={$submitting}>Login</Form.Button>
			</Field.FieldGroup>
		</form>
		<p class="mt-4 text-center text-sm text-muted-foreground">
			Don't have an account?
			<a href={resolve('/register')} class="underline underline-offset-4 hover:text-primary">
				Register
			</a>
		</p>
	</Card.Content>
</Card.Root>

<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { loginSchema } from '../domain/schema';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import { LANDING_ROUTE } from '$lib/guards/auth';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	let showPassword = $state(false);

	const form = superForm(defaults(zod4(loginSchema)), {
		SPA: true,
		validators: zod4(loginSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) {
				toast.error('Form not valid. Please check the fields.');
				return;
			}

			toast.promise(
				(async () => {
					await authStore.login({
						name: form.data.username,
						password: form.data.password
					});
					reset();
					await goto(resolve(LANDING_ROUTE));
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
							<div class="relative">
								<Input
									{...props}
									type={showPassword ? 'text' : 'password'}
									bind:value={$formData.password}
									placeholder="Enter your password"
									class="pr-10"
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									class="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									onclick={() => (showPassword = !showPassword)}
								>
									{#if showPassword}
										<EyeOff class="size-4 text-muted-foreground" />
									{:else}
										<Eye class="size-4 text-muted-foreground" />
									{/if}
								</Button>
							</div>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Button disabled={$submitting}>Login</Form.Button>
			</Field.FieldGroup>
		</form>
		<!-- <p class="mt-4 text-center text-sm text-muted-foreground">
			Don't have an account?
			<a href={resolve('/register')} class="underline underline-offset-4 hover:text-primary">
				Register
			</a>
		</p> -->
	</Card.Content>
</Card.Root>

<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, shelterCodeFromRoles, shelterScopeRole } from '$lib/auth/roles';
	import {
		CreateUserForm,
		UserList,
		useUsers,
		useCreateUser,
		useDeleteUser,
		type CreateUserInput
	} from '$lib/features/users';

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const shelterCode = $derived(shelterCodeFromRoles(roles));

	const usersQuery = useUsers();
	const createMutation = useCreateUser();
	const deleteMutation = useDeleteUser();

	function handleCreate(input: CreateUserInput) {
		const code = isSA ? input.shelter_code : shelterCode;
		if (!code) {
			toast.error('A shelter code is required');
			return;
		}
		// Build the canonical roles[]: shelter scope + capability (server re-validates).
		const userRoles = [shelterScopeRole(code), input.capability];
		createMutation.mutate(
			{ name: input.username, password: input.password, roles: userRoles },
			{
				onSuccess: () => toast.success(`User "${input.username}" created`),
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}

	function handleDelete(name: string) {
		deleteMutation.mutate(name, {
			onSuccess: () => toast.success(`User "${name}" deleted`),
			onError: (err: Error) => toast.error(err.message)
		});
	}
</script>

<div class="container mx-auto max-w-2xl p-6">
	<h1 class="mb-6 text-3xl font-bold">User Management</h1>

	<Card.Root class="mb-8">
		<Card.Header>
			<Card.Title>Create user</Card.Title>
			<Card.Description>
				{isSA ? 'Add staff or a shelter manager to any shelter.' : `Add staff to ${shelterCode}.`}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<CreateUserForm
				onsubmit={handleCreate}
				{isSA}
				{shelterCode}
				pending={createMutation.isPending}
			/>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Users</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if usersQuery.isLoading}
				<p class="text-sm text-muted-foreground">Loading...</p>
			{:else if usersQuery.isError}
				<p class="text-sm text-destructive">Error: {usersQuery.error?.message}</p>
			{:else}
				<UserList
					users={usersQuery.data ?? []}
					ondelete={handleDelete}
					pending={deleteMutation.isPending}
				/>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

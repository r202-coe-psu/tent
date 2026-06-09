<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { CreateUserForm, UserList, useUsers, useCreateUser, useDeleteUser } from '$lib/features/users';
	import type { CouchUserDoc } from '$lib/features/users';

	const usersQuery = useUsers();
	const createMutation = useCreateUser();
	const deleteMutation = useDeleteUser();

	function handleCreate(data: { name: string; password: string }) {
		createMutation.mutate({ name: data.name, password: data.password }, {
			onSuccess: () => toast.success(`User "${data.name}" created`),
			onError: (err: Error) => toast.error(err.message)
		});
	}

	function handleDelete(user: CouchUserDoc) {
		deleteMutation.mutate({ id: user._id, rev: user._rev }, {
			onSuccess: () => toast.success(`User "${user.name}" deleted`),
			onError: (err: Error) => toast.error(err.message)
		});
	}
</script>

<div class="container mx-auto max-w-2xl p-6">
	<h1 class="mb-6 text-3xl font-bold">User Management</h1>

	<Card.Root class="mb-8">
		<Card.Header>
			<Card.Title>Create User</Card.Title>
		</Card.Header>
		<Card.Content>
			<CreateUserForm onsubmit={handleCreate} pending={createMutation.isPending} />
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

<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		EvacueeForm,
		EvacueeList,
		useEvacuees,
		useCreateEvacuee,
		SHELTER_CODE,
		type EvacueeInput
	} from '$lib/features/people';

	const evacueesQuery = useEvacuees();
	const createMutation = useCreateEvacuee();

	function handleRegister(input: EvacueeInput) {
		const ctx = { shelterCode: SHELTER_CODE, createdBy: authStore.user?.name ?? 'unknown' };
		createMutation.mutate(
			{ input, ctx },
			{
				onSuccess: (evacuee) =>
					toast.success(`Registered ${evacuee.first_name} ${evacuee.last_name}`),
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}
</script>

<div class="container mx-auto max-w-2xl p-6">
	<h1 class="mb-6 text-3xl font-bold">People</h1>

	<Card.Root class="mb-8">
		<Card.Header>
			<Card.Title>Register evacuee</Card.Title>
		</Card.Header>
		<Card.Content>
			<EvacueeForm onsubmit={handleRegister} pending={createMutation.isPending} />
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Evacuees</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if evacueesQuery.isLoading}
				<p class="text-sm text-muted-foreground">Loading...</p>
			{:else if evacueesQuery.isError}
				<p class="text-sm text-destructive">Error: {evacueesQuery.error?.message}</p>
			{:else}
				<EvacueeList evacuees={evacueesQuery.data ?? []} />
			{/if}
		</Card.Content>
	</Card.Root>
</div>

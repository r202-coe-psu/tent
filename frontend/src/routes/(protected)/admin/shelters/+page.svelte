<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import {
		CreateShelterForm,
		ShelterList,
		useShelters,
		useCreateShelter,
		type CreateShelterInput
	} from '$lib/features/shelters';

	const sheltersQuery = useShelters();
	const createMutation = useCreateShelter();

	function handleCreate(input: CreateShelterInput) {
		createMutation.mutate(input, {
			onSuccess: (res) => toast.success(`Shelter "${res.code}" provisioned`),
			onError: (err: Error) => toast.error(err.message)
		});
	}
</script>

<div class="container mx-auto max-w-2xl p-6">
	<h1 class="mb-6 text-3xl font-bold">Shelters</h1>

	<Card.Root class="mb-8">
		<Card.Header>
			<Card.Title>Provision shelter</Card.Title>
			<Card.Description
				>Creates the database, security, validation, and registry entry.</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<CreateShelterForm onsubmit={handleCreate} pending={createMutation.isPending} />
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Provisioned shelters</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if sheltersQuery.isLoading}
				<p class="text-sm text-muted-foreground">Loading...</p>
			{:else if sheltersQuery.isError}
				<p class="text-sm text-destructive">Error: {sheltersQuery.error?.message}</p>
			{:else}
				<ShelterList shelters={sheltersQuery.data ?? []} />
			{/if}
		</Card.Content>
	</Card.Root>
</div>

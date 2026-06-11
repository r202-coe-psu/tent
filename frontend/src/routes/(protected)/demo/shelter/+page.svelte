<script lang="ts">
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		CapacityCard,
		IntakeForm,
		InventoryPanel,
		OccupantList,
		parseAccessibleShelters,
		startShelterSync,
		type ShelterId
	} from '$lib/features/shelter';

	const access = $derived(parseAccessibleShelters(authStore.user?.roles ?? []));

	let selectedId = $state<ShelterId | null>(null);
	const selected = $derived(access.find((a) => a.id === selectedId) ?? access[0] ?? null);

	// Default selection once access resolves.
	$effect(() => {
		if (!selectedId && access.length > 0) selectedId = access[0].id;
	});

	// Live-sync every shelter the user can reach; cleaned up on unmount.
	onMount(() => startShelterSync(access));
</script>

<div class="container mx-auto max-w-5xl p-6">
	<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-3xl font-bold">Shelter operations</h1>
		{#if access.length > 1}
			<div class="flex gap-1 rounded-md border p-1">
				{#each access as a (a.id)}
					<button
						class="rounded px-3 py-1 text-sm {selected?.id === a.id
							? 'bg-primary text-primary-foreground'
							: 'hover:bg-muted'}"
						onclick={() => (selectedId = a.id)}
					>
						Shelter {a.id}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if !selected}
		<p class="text-sm text-muted-foreground">
			Your account has no shelter access. Ask an admin to assign you a shelter role, or run the demo
			setup.
		</p>
	{:else}
		<p class="mb-6 text-sm text-muted-foreground">
			Shelter {selected.id} · your role: <span class="font-medium">{selected.role}</span> · offline-first
			(PouchDB ↔ CouchDB)
		</p>

		{#key selected.id}
			<div class="grid gap-6 md:grid-cols-2">
				<div class="flex flex-col gap-6">
					<CapacityCard id={selected.id} role={selected.role} />
					<IntakeForm id={selected.id} />
					<OccupantList id={selected.id} />
				</div>
				<div>
					<InventoryPanel id={selected.id} role={selected.role} />
				</div>
			</div>
		{/key}
	{/if}
</div>

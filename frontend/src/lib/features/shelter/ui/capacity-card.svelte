<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { countCheckedIn, type ShelterId, type ShelterRole } from '../domain/shelter';
	import { useOccupants, useSaveConfig, useShelterConfig } from '../application/queries';

	interface Props {
		id: ShelterId;
		role: ShelterRole;
	}
	let { id, role }: Props = $props();

	const configQuery = useShelterConfig(id);
	const occupantsQuery = useOccupants(id);
	const saveConfig = useSaveConfig(id);

	const occupancy = $derived(countCheckedIn(occupantsQuery.data ?? []));
	const capacity = $derived(configQuery.data?.capacity ?? 0);
	const pct = $derived(capacity > 0 ? Math.min(100, Math.round((occupancy / capacity) * 100)) : 0);
	const full = $derived(capacity > 0 && occupancy >= capacity);

	let editing = $state(false);
	let name = $state('');
	let capacityInput = $state(0);

	function startEdit() {
		name = configQuery.data?.name ?? `Shelter ${id}`;
		capacityInput = configQuery.data?.capacity ?? 0;
		editing = true;
	}

	function save(e: SubmitEvent) {
		e.preventDefault();
		saveConfig.mutate(
			{ name: name.trim(), capacity: Number(capacityInput) },
			{
				onSuccess: () => {
					toast.success('Shelter settings saved');
					editing = false;
				},
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}
</script>

<Card>
	<CardHeader class="flex flex-row items-start justify-between gap-2">
		<CardTitle>{configQuery.data?.name ?? `Shelter ${id}`}</CardTitle>
		{#if role === 'manager' && !editing}
			<Button variant="outline" size="sm" onclick={startEdit}>Settings</Button>
		{/if}
	</CardHeader>
	<CardContent>
		{#if editing}
			<form onsubmit={save} class="flex flex-col gap-3">
				<div class="flex flex-col gap-1">
					<Label for="shelter-name">Name</Label>
					<Input id="shelter-name" bind:value={name} required />
				</div>
				<div class="flex flex-col gap-1">
					<Label for="shelter-capacity">Capacity</Label>
					<Input id="shelter-capacity" type="number" min="0" bind:value={capacityInput} required />
				</div>
				<div class="flex gap-2">
					<Button type="submit" size="sm" disabled={saveConfig.isPending}>Save</Button>
					<Button type="button" variant="ghost" size="sm" onclick={() => (editing = false)}>
						Cancel
					</Button>
				</div>
			</form>
		{:else}
			<div class="flex items-baseline justify-between">
				<span class="text-2xl font-bold" class:text-destructive={full}>
					{occupancy} / {capacity || '—'}
				</span>
				<span class="text-sm text-muted-foreground">occupants</span>
			</div>
			<div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
				<div
					class="h-full rounded-full transition-all {full ? 'bg-destructive' : 'bg-primary'}"
					style="width: {pct}%"
				></div>
			</div>
			{#if full}
				<p class="mt-2 text-sm text-destructive">Shelter is at full capacity.</p>
			{/if}
		{/if}
	</CardContent>
</Card>

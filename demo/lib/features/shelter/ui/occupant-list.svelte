<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { Occupant, ShelterId } from '../domain/shelter';
	import { useCheckOut, useOccupants } from '../application/queries';

	interface Props {
		id: ShelterId;
	}
	let { id }: Props = $props();

	const occupantsQuery = useOccupants(id);
	const checkOut = useCheckOut(id);

	const checkedIn = $derived(
		(occupantsQuery.data ?? [])
			.filter((o) => o.status === 'in')
			.sort((a, b) => b.checkInAt.localeCompare(a.checkInAt))
	);
	const checkedOutCount = $derived(
		(occupantsQuery.data ?? []).filter((o) => o.status === 'out').length
	);

	function handleCheckOut(occ: Occupant) {
		checkOut.mutate(occ, {
			onSuccess: () => toast.success(`${occ.name} checked out`),
			onError: (err: Error) => toast.error(`Check-out failed: ${err.message}`)
		});
	}
</script>

<Card>
	<CardHeader>
		<CardTitle
			>Occupants ({checkedIn.length} in{checkedOutCount
				? `, ${checkedOutCount} out`
				: ''})</CardTitle
		>
	</CardHeader>
	<CardContent>
		{#if occupantsQuery.isLoading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if checkedIn.length === 0}
			<p class="text-sm text-muted-foreground">No one is checked in.</p>
		{:else}
			<ul class="divide-y">
				{#each checkedIn as occ (occ._id)}
					<li class="flex items-center justify-between gap-2 py-2">
						<div>
							<p class="font-medium">{occ.name}</p>
							<p class="text-xs text-muted-foreground">
								In since {new Date(occ.checkInAt).toLocaleString()}
								{#if occ.note}— {occ.note}{/if}
							</p>
						</div>
						<Button variant="outline" size="sm" onclick={() => handleCheckOut(occ)}>
							Check out
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</CardContent>
</Card>

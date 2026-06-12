<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { ShelterId } from '../domain/shelter';
	import { ShelterFullError, useCheckIn } from '../application/queries';

	interface Props {
		id: ShelterId;
	}
	let { id }: Props = $props();

	const checkIn = useCheckIn(id);

	let name = $state('');
	let note = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		checkIn.mutate(
			{ name: name.trim(), note: note.trim() },
			{
				onSuccess: () => {
					toast.success(`${name.trim()} checked in`);
					name = '';
					note = '';
				},
				onError: (err: Error) =>
					toast.error(
						err instanceof ShelterFullError ? err.message : `Check-in failed: ${err.message}`
					)
			}
		);
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Check in a person</CardTitle>
	</CardHeader>
	<CardContent>
		<form onsubmit={submit} class="flex flex-col gap-3">
			<div class="flex flex-col gap-1">
				<Label for="intake-name">Name</Label>
				<Input id="intake-name" bind:value={name} placeholder="Full name" required />
			</div>
			<div class="flex flex-col gap-1">
				<Label for="intake-note">Note</Label>
				<Input id="intake-note" bind:value={note} placeholder="e.g. needs medical attention" />
			</div>
			<Button type="submit" disabled={checkIn.isPending || !name.trim()}>
				{checkIn.isPending ? 'Checking in…' : 'Check in'}
			</Button>
		</form>
	</CardContent>
</Card>

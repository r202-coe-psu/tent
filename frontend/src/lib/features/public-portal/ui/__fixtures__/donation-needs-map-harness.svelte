<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { DonationNeedsEntry } from '../../domain/donation-map';
	import DonationNeedsMap from '../donation-needs-map.svelte';

	/** Test-only parent: owns the picked shelter, as the needs board does, and lets a test move it. */
	let {
		shelters,
		initialCode,
		card
	}: {
		shelters: DonationNeedsEntry[];
		initialCode: string | null;
		card: Snippet<[{ name: string }, unknown]>;
	} = $props();

	// svelte-ignore state_referenced_locally
	let selectedCode = $state(initialCode);
</script>

<DonationNeedsMap {shelters} {selectedCode} onSelect={(code) => (selectedCode = code)} {card} />
{#each shelters as entry (entry.code)}
	<button type="button" data-testid="pick-{entry.code}" onclick={() => (selectedCode = entry.code)}>
		{entry.code}
	</button>
{/each}

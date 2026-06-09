<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { CouchUserDoc } from '../data/users.api';

	let {
		users,
		ondelete,
		pending = false
	}: {
		users: CouchUserDoc[];
		ondelete: (user: CouchUserDoc) => void;
		pending?: boolean;
	} = $props();
</script>

{#if users.length === 0}
	<p class="text-sm text-muted-foreground">No users yet.</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each users as user (user._id)}
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium">{user.name}</span>
				<Button
					variant="destructive"
					size="sm"
					disabled={pending}
					onclick={() => ondelete(user)}
				>
					Delete
				</Button>
			</div>
		{/each}
	</div>
{/if}

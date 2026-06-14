<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { UserSummary } from '../data/users.api';

	let {
		users,
		ondelete,
		pending = false
	}: {
		users: UserSummary[];
		ondelete: (name: string) => void;
		pending?: boolean;
	} = $props();
</script>

{#if users.length === 0}
	<p class="text-sm text-muted-foreground">No users yet.</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each users as user (user.name)}
			<div class="flex items-center justify-between gap-2">
				<div class="min-w-0">
					<span class="text-sm font-medium">{user.name}</span>
					<span class="ml-2 text-xs text-muted-foreground">{user.roles.join(', ') || '—'}</span>
				</div>
				<Button
					variant="destructive"
					size="sm"
					disabled={pending}
					onclick={() => ondelete(user.name)}
				>
					Delete
				</Button>
			</div>
		{/each}
	</div>
{/if}

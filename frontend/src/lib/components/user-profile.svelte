<script lang="ts">
	import {
		Card,
		CardHeader,
		CardTitle,
		CardContent,
		CardDescription
	} from '$lib/components/ui/card';
	import type { User } from '$lib/features/me';

	interface Props {
		user?: User | null;
	}

	let { user }: Props = $props();
</script>

{#if user}
	<Card class="max-w-md">
		<CardHeader>
			<CardTitle>User Profile</CardTitle>
			<CardDescription>Current user information</CardDescription>
		</CardHeader>
		<CardContent class="space-y-2">
			<div>
				<strong>Username:</strong>
				{user.name}
			</div>
			<div>
				<strong>Roles:</strong>
				{user.roles.length ? user.roles.join(', ') : '—'}
			</div>
		</CardContent>
	</Card>
{:else}
	<p>No user data available</p>
{/if}

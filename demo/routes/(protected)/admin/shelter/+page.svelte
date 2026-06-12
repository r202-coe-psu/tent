<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import {
		setupShelters,
		teardownShelters,
		verifyShelters,
		SHELTER_SEED_USERS,
		SHELTER_SEED_CONFIG,
		type SetupStep,
		type ShelterVerifyResult
	} from '$lib/features/shelter';

	let steps = $state<SetupStep[]>([]);
	let verifyResult = $state<ShelterVerifyResult | null>(null);
	let busy = $state(false);

	async function run(label: string, fn: () => Promise<unknown>) {
		busy = true;
		verifyResult = null;
		steps = [];
		try {
			const result = await fn();
			if (Array.isArray(result)) steps = result as SetupStep[];
			else verifyResult = result as ShelterVerifyResult;
			toast.success(`${label} complete`);
		} catch (err) {
			toast.error(`${label} failed: ${(err as Error).message}`);
		} finally {
			busy = false;
		}
	}

	const badge = (s: SetupStep['status']) =>
		s === 'ok' ? 'text-green-600' : s === 'skip' ? 'text-muted-foreground' : 'text-destructive';
</script>

<div class="container mx-auto max-w-3xl p-6">
	<h1 class="mb-2 text-3xl font-bold">Shelter demo setup</h1>
	<p class="mb-6 text-sm text-muted-foreground">
		Creates databases <code>shelter_a/_b/_c</code>, per-shelter <code>_security</code> +
		<code>validate_doc_update</code> rules, seed inventory, and one manager + one volunteer per shelter.
	</p>

	<div class="mb-6 flex flex-wrap gap-2">
		<Button disabled={busy} onclick={() => run('Setup', setupShelters)}>Setup</Button>
		<Button disabled={busy} variant="outline" onclick={() => run('Verify', verifyShelters)}>
			Verify
		</Button>
		<Button disabled={busy} variant="destructive" onclick={() => run('Teardown', teardownShelters)}>
			Teardown
		</Button>
	</div>

	{#if steps.length > 0}
		<Card class="mb-6">
			<CardHeader><CardTitle>Result</CardTitle></CardHeader>
			<CardContent>
				<ul class="space-y-1 text-sm">
					{#each steps as step (step.label)}
						<li class="flex justify-between gap-4">
							<span>{step.label}</span>
							<span class={badge(step.status)}>
								{step.status}{step.detail ? ` (${step.detail})` : ''}
							</span>
						</li>
					{/each}
				</ul>
			</CardContent>
		</Card>
	{/if}

	{#if verifyResult}
		<Card class="mb-6">
			<CardHeader><CardTitle>Verify</CardTitle></CardHeader>
			<CardContent class="space-y-4 text-sm">
				<div>
					<p class="mb-1 font-medium">Databases</p>
					<ul class="space-y-1">
						{#each verifyResult.databases as db (db.db)}
							<li class="flex justify-between gap-4">
								<span>{db.db}</span>
								<span class={db.exists ? 'text-green-600' : 'text-destructive'}>
									{db.exists ? 'exists' : (db.error ?? 'missing')}
								</span>
							</li>
						{/each}
					</ul>
				</div>
				<div>
					<p class="mb-1 font-medium">Users</p>
					<ul class="space-y-1">
						{#each verifyResult.users as u (u.name)}
							<li class="flex justify-between gap-4">
								<span>{u.name}</span>
								<span class={u.roles ? 'text-green-600' : 'text-destructive'}>
									{u.roles ? u.roles.join(', ') : (u.error ?? 'missing')}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			</CardContent>
		</Card>
	{/if}

	<Card>
		<CardHeader><CardTitle>Demo accounts</CardTitle></CardHeader>
		<CardContent>
			<p class="mb-3 text-sm text-muted-foreground">
				After setup, log in as any of these to try the shelter UI.
			</p>
			<table class="w-full text-sm">
				<thead class="text-left text-muted-foreground">
					<tr>
						<th class="py-1">Username</th>
						<th>Password</th>
						<th>Shelter</th>
						<th>Role</th>
					</tr>
				</thead>
				<tbody>
					{#each SHELTER_SEED_USERS as u (u.name)}
						<tr class="border-t">
							<td class="py-1 font-mono">{u.name}</td>
							<td class="font-mono">{u.password}</td>
							<td>{u.shelter} — {SHELTER_SEED_CONFIG[u.shelter].name}</td>
							<td>{u.role}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</CardContent>
	</Card>
</div>

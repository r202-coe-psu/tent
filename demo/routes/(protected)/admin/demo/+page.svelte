<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		setupDemo,
		teardownDemo,
		verifySetup,
		DEMO_USERS,
		DB_META,
		DEMO_DBS,
		type SetupStep,
		type DbVerifyResult,
		type UserVerifyResult
	} from '$lib/features/demo';
	import { resolve } from '$app/paths';

	let steps = $state<SetupStep[]>([]);
	let running = $state(false);
	let verifyResult = $state<{ databases: DbVerifyResult[]; users: UserVerifyResult[] } | null>(null);
	let verifying = $state(false);

	async function runVerify() {
		verifying = true;
		try {
			verifyResult = await verifySetup();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			verifying = false;
		}
	}

	async function runSetup() {
		running = true;
		steps = [];
		try {
			steps = await setupDemo();
			toast.success('Demo environment ready');
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			running = false;
		}
	}

	async function runTeardown() {
		running = true;
		steps = [];
		try {
			steps = await teardownDemo();
			toast.success('Demo environment removed');
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			running = false;
		}
	}

	const canAccessMap: Record<string, string[]> = {
		alice: ['demo_alpha', 'demo_shared'],
		bob: ['demo_beta', 'demo_shared'],
		charlie: ['demo_alpha', 'demo_beta', 'demo_shared']
	};

	const statusDotClass: Record<SetupStep['status'], string> = {
		ok: 'bg-green-400',
		skip: 'bg-yellow-400',
		error: 'bg-red-400'
	};
</script>

<div class="container mx-auto max-w-2xl p-6">
	<h1 class="mb-6 text-3xl font-bold">RBAC Demo Setup</h1>

	<!-- Action buttons -->
	<div class="mb-6 flex gap-3">
		<Button onclick={runSetup} disabled={running}>Setup Demo</Button>
		<Button variant="destructive" onclick={runTeardown} disabled={running}>Teardown</Button>
		<Button variant="outline" onclick={runVerify} disabled={running || verifying}>
			{#if verifying}
				<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2"></span>
			{/if}
			Verify Setup
		</Button>
	</div>

	<!-- Demo Users card -->
	<Card.Root class="mb-6">
		<Card.Header>
			<Card.Title>Demo Users</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b text-left text-muted-foreground">
							<th class="pb-2 pr-4 font-medium">User</th>
							<th class="pb-2 pr-4 font-medium">Password</th>
							<th class="pb-2 pr-4 font-medium">Roles</th>
							<th class="pb-2 font-medium">Can Access</th>
						</tr>
					</thead>
					<tbody>
						{#each DEMO_USERS as user (user.name)}
							<tr class="border-b last:border-0">
								<td class="py-2 pr-4 font-mono font-medium">{user.name}</td>
								<td class="py-2 pr-4 font-mono text-muted-foreground">{user.password}</td>
								<td class="py-2 pr-4">
									{#each user.roles as role, i (role)}
										<code class="rounded bg-muted px-1 py-0.5 text-xs">{role}</code>{#if i < user.roles.length - 1}<span class="mx-0.5 text-muted-foreground">,</span>{/if}
									{/each}
								</td>
								<td class="py-2">
									{#each canAccessMap[user.name] ?? [] as db, i (db)}
										<code class="rounded bg-muted px-1 py-0.5 text-xs">{db}</code>{#if i < (canAccessMap[user.name]?.length ?? 0) - 1}<span class="mx-0.5 text-muted-foreground">,</span>{/if}
									{/each}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="mt-4 border-t pt-4">
				<a href={resolve('/demo')} class="text-sm text-primary hover:underline">→ Go to Demo Page</a>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Database Setup card -->
	<Card.Root class="mb-6">
		<Card.Header>
			<Card.Title>Database Setup</Card.Title>
		</Card.Header>
		<Card.Content>
			<ul class="space-y-2 text-sm">
				{#each DEMO_DBS as db (db)}
					<li class="flex items-center gap-3">
						<code class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{db}</code>
						<span class="text-muted-foreground">requires:</span>
						<span class="flex gap-1">
							{#each DB_META[db].requiredRoles as role (role)}
								<code class="rounded bg-muted px-1 py-0.5 text-xs">{role}</code>
							{/each}
						</span>
					</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>

	<!-- Setup Log card -->
	{#if steps.length > 0}
		<Card.Root class="mb-6">
			<Card.Header>
				<Card.Title>Setup Log</Card.Title>
			</Card.Header>
			<Card.Content>
				<ul class="space-y-1.5 text-sm">
					{#each steps as step, i (i)}
						<li class="flex items-center gap-2">
							<span class="h-2.5 w-2.5 shrink-0 rounded-full {statusDotClass[step.status]}"></span>
							<span class="font-medium">{step.label}</span>
							{#if step.detail}
								<span class="text-muted-foreground">— {step.detail}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- Running spinner (when running but no steps yet) -->
	{#if running && steps.length === 0}
		<p class="flex items-center gap-2 text-sm text-muted-foreground">
			<span
				class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
			></span>
			Running…
		</p>
	{/if}

	<!-- Verification Results card -->
	{#if verifyResult !== null}
		<Card.Root class="mb-6">
			<Card.Header>
				<Card.Title>Verification Results</Card.Title>
			</Card.Header>
			<Card.Content>
				<!-- Databases -->
				<p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Databases</p>
				<ul class="mb-4 space-y-2 text-sm">
					{#each verifyResult.databases as db (db.db)}
						<li class="flex flex-col gap-0.5">
							<div class="flex items-center gap-2">
								<code class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{db.db}</code>
								{#if db.exists}
									<span class="text-green-400 font-medium">✓ exists</span>
								{:else}
									<span class="text-red-400 font-medium">✗ not found</span>
									{#if db.error}
										<span class="text-muted-foreground text-xs">— {db.error}</span>
									{/if}
								{/if}
							</div>
							{#if db.exists}
								{@const roles = (db.security as any)?.members?.roles as string[] | undefined}
								<div class="ml-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
									<span>members.roles:</span>
									{#if roles && roles.length > 0}
										{#each roles as role (role)}
											<code class="rounded bg-muted px-1 py-0.5">{role}</code>
										{/each}
									{:else}
										<span class="text-muted-foreground">(open to all authenticated)</span>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<!-- Users -->
				<p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Users</p>
				<ul class="space-y-2 text-sm">
					{#each verifyResult.users as user (user.name)}
						<li class="flex flex-wrap items-center gap-2">
							<code class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{user.name}</code>
							{#if user.roles !== null}
								{#if (user.roles as string[]).length > 0}
									{#each user.roles as role (role)}
										<code class="rounded bg-muted px-1 py-0.5 text-xs">{role}</code>
									{/each}
								{:else}
									<span class="text-muted-foreground text-xs">(no roles)</span>
								{/if}
							{:else}
								<span class="text-red-400 font-medium">✗ not found</span>
								{#if user.error}
									<span class="text-muted-foreground text-xs">— {user.error}</span>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

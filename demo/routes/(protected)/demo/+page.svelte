<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		DEMO_DBS,
		DB_META,
		DEMO_USERS,
		testDbAccess,
		testSharedWrite,
		getLiveSession,
		type DemoDb,
		type AccessResult
	} from '$lib/features/demo';

	let liveSession = $state<{ name: string | null; roles: string[] } | null>(null);
	let sessionLoading = $state(false);

	async function refreshSession() {
		sessionLoading = true;
		try {
			liveSession = await getLiveSession();
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			sessionLoading = false;
		}
	}

	// access results keyed by db name
	let results = $state<Partial<Record<DemoDb, AccessResult>>>({});
	// shared write results
	let sharedWrite = $state<{
		alpha?: { ok: boolean; error?: string };
		beta?: { ok: boolean; error?: string };
	}>({});
	let sharedWriteLoading = $state<{ alpha: boolean; beta: boolean }>({
		alpha: false,
		beta: false
	});

	async function testDb(db: DemoDb) {
		results[db] = { canRead: false, canWrite: false, loading: true };
		const r = await testDbAccess(db);
		results[db] = { ...r, loading: false };
	}

	async function testAll() {
		for (const db of DEMO_DBS) {
			testDb(db); // run in parallel, no await
		}
	}

	async function testSharedFor(team: 'alpha' | 'beta') {
		sharedWriteLoading[team] = true;
		sharedWrite[team] = await testSharedWrite(team);
		sharedWriteLoading[team] = false;
	}

	// Determine which DBs the current user can theoretically access based on roles
	const userRoles = $derived(authStore.user?.roles ?? []);

	function hasAccessTo(db: DemoDb): boolean {
		const required = DB_META[db].requiredRoles;
		return required.some((r) => userRoles.includes(r));
	}

	const canAccessMap: Record<string, string[]> = {
		alice: ['demo_alpha', 'demo_shared'],
		bob: ['demo_beta', 'demo_shared'],
		charlie: ['demo_alpha', 'demo_beta', 'demo_shared']
	};
</script>

<div class="container mx-auto max-w-3xl p-6">
	<!-- Header -->
	<div class="mb-6 flex items-start justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold">RBAC Demo</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				ทดสอบสิทธิ์ access แบบ real-time กับ CouchDB
			</p>
		</div>
		<Button variant="outline" onclick={testAll}>Run All Tests</Button>
	</div>

	<!-- Your Profile card -->
	<Card.Root class="mb-6">
		<Card.Header>
			<Card.Title>Your Profile</Card.Title>
		</Card.Header>
		<Card.Content>
			<p class="mb-2 text-sm font-medium">
				Logged in as: <span class="font-mono">{authStore.user?.name ?? '—'}</span>
			</p>
			<div class="mb-3 flex flex-wrap items-center gap-1 text-sm">
				<span class="text-muted-foreground">Roles:</span>
				{#if userRoles.length > 0}
					{#each userRoles as role (role)}
						<code class="rounded bg-muted px-1.5 py-0.5 text-xs">{role}</code>
					{/each}
				{:else}
					<span class="text-muted-foreground">(no roles)</span>
				{/if}
			</div>
			<div class="text-sm">
				<p class="mb-1 text-muted-foreground">Theoretical DB access:</p>
				<div class="flex flex-wrap gap-2">
					{#each DEMO_DBS as db (db)}
						{#if hasAccessTo(db)}
							<span class="font-mono text-xs text-green-400">{db}</span>
						{:else}
							<span class="font-mono text-xs text-red-400">{db}</span>
						{/if}
					{/each}
				</div>
			</div>

			<div class="mt-4 border-t pt-4">
				<p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Live CouchDB Session</p>
				<Button size="sm" variant="outline" onclick={refreshSession} disabled={sessionLoading}>
					{#if sessionLoading}
						<span class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent mr-1.5"></span>
					{/if}
					Refresh from /_session
				</Button>
				{#if liveSession !== null}
					<div class="mt-3 space-y-1.5 text-sm">
						<p>name: <code class="rounded bg-muted px-1.5 py-0.5 text-xs">{liveSession.name}</code></p>
						<div class="flex flex-wrap items-center gap-1">
							<span>roles:</span>
							{#if liveSession.roles.length > 0}
								{#each liveSession.roles as role (role)}
									<code class="rounded bg-muted px-1.5 py-0.5 text-xs">{role}</code>
								{/each}
							{:else}
								<span class="text-muted-foreground text-xs">(no roles)</span>
							{/if}
						</div>
						{#if JSON.stringify([...liveSession.roles].sort()) !== JSON.stringify([...userRoles].sort())}
							<p class="mt-1 text-sm font-medium text-amber-400">
								⚠ Roles differ from cached session — please re-login
							</p>
						{/if}
					</div>
				{/if}
				<p class="mt-2 text-xs text-muted-foreground">หลัง setup ต้อง re-login เพื่อให้ session รับ roles ใหม่</p>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Demo Users Reference card -->
	<Card.Root class="mb-6">
		<Card.Header>
			<Card.Title>Demo Users Reference</Card.Title>
			<Card.Description>Login as one of these users to see RBAC in action</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="overflow-x-auto">
				<table class="w-full text-xs">
					<thead>
						<tr class="border-b text-left text-muted-foreground">
							<th class="pb-2 pr-3 font-medium">User</th>
							<th class="pb-2 pr-3 font-medium">Password</th>
							<th class="pb-2 pr-3 font-medium">Roles</th>
							<th class="pb-2 font-medium">Expected Access</th>
						</tr>
					</thead>
					<tbody>
						{#each DEMO_USERS as user (user.name)}
							<tr class="border-b last:border-0">
								<td class="py-1.5 pr-3 font-mono font-medium">{user.name}</td>
								<td class="py-1.5 pr-3 font-mono text-muted-foreground">{user.password}</td>
								<td class="py-1.5 pr-3">
									{#each user.roles as role, i (role)}
										<code class="rounded bg-muted px-1 py-0.5 text-xs">{role}</code>{#if i < user.roles.length - 1}<span class="mx-0.5 text-muted-foreground">,</span>{/if}
									{/each}
								</td>
								<td class="py-1.5">
									{#each canAccessMap[user.name] ?? [] as db, i (db)}
										<code class="rounded bg-muted px-1 py-0.5 text-xs">{db}</code>{#if i < (canAccessMap[user.name]?.length ?? 0) - 1}<span class="mx-0.5 text-muted-foreground">,</span>{/if}
									{/each}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Pattern 1 — Database-Level Access -->
	<h2 class="mb-4 text-xl font-semibold">Pattern 1 — Database-Level Access</h2>
	<div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
		{#each DEMO_DBS as db (db)}
			<Card.Root>
				<Card.Header class="pb-2">
					<Card.Title class="text-base">{DB_META[db].label}</Card.Title>
					<Card.Description class="text-xs">
						Required:
						{#each DB_META[db].requiredRoles as role, i (role)}
							<code class="rounded bg-muted px-1 py-0.5 text-xs">{role}</code>{#if i < DB_META[db].requiredRoles.length - 1}<span class="mx-0.5">,</span>{/if}
						{/each}
					</Card.Description>
				</Card.Header>
				<Card.Content class="pt-0">
					<Button size="sm" onclick={() => testDb(db)} class="mb-3 w-full">Test Access</Button>
					{#if results[db]}
						{#if results[db]?.loading}
							<div class="flex justify-center py-2">
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground"
								></div>
							</div>
						{:else}
							<div class="space-y-1 text-xs">
								<div class="flex items-start gap-1.5">
									{#if results[db]?.canRead}
										<span class="font-bold text-green-400">✓</span>
									{:else}
										<span class="font-bold text-red-400">✗</span>
									{/if}
									<span class="font-medium">Read</span>
									{#if results[db]?.readError}
										<span class="text-muted-foreground">{results[db]?.readError}</span>
									{/if}
								</div>
								<div class="flex items-start gap-1.5">
									{#if results[db]?.canWrite}
										<span class="font-bold text-green-400">✓</span>
									{:else}
										<span class="font-bold text-red-400">✗</span>
									{/if}
									<span class="font-medium">Write</span>
									{#if results[db]?.writeError}
										<span class="text-muted-foreground">{results[db]?.writeError}</span>
									{/if}
								</div>
							</div>
						{/if}
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>

	<!-- Pattern 2 — Document-Level Write Control -->
	<h2 class="mb-3 text-xl font-semibold">Pattern 2 — Document-Level Write Control</h2>
	<p class="mb-4 text-sm text-muted-foreground">
		demo_shared เปิดอ่านให้ทั้ง team:alpha และ team:beta แต่การเขียน —
		validate_doc_update บังคับว่าต้องเขียนเฉพาะ doc ที่มี team ตรงกับ role ของตัวเอง
	</p>
	<Card.Root class="mb-6">
		<Card.Content class="pt-6">
			<div class="flex flex-col gap-4 sm:flex-row">
				<!-- Alpha write test -->
				<div class="flex-1 space-y-2">
					<Button
						variant="outline"
						size="sm"
						onclick={() => testSharedFor('alpha')}
						disabled={sharedWriteLoading.alpha}
						class="w-full"
					>
						{#if sharedWriteLoading.alpha}
							<span
								class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
							></span>
						{/if}
						Write &#123;team:'alpha'&#125; doc
					</Button>
					{#if sharedWrite.alpha !== undefined}
						{#if sharedWrite.alpha.ok}
							<p class="text-xs font-medium text-green-400">✓ เขียนได้</p>
						{:else}
							<p class="text-xs font-medium text-red-400">✗ {sharedWrite.alpha.error}</p>
						{/if}
					{/if}
				</div>

				<!-- Beta write test -->
				<div class="flex-1 space-y-2">
					<Button
						variant="outline"
						size="sm"
						onclick={() => testSharedFor('beta')}
						disabled={sharedWriteLoading.beta}
						class="w-full"
					>
						{#if sharedWriteLoading.beta}
							<span
								class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
							></span>
						{/if}
						Write &#123;team:'beta'&#125; doc
					</Button>
					{#if sharedWrite.beta !== undefined}
						{#if sharedWrite.beta.ok}
							<p class="text-xs font-medium text-green-400">✓ เขียนได้</p>
						{:else}
							<p class="text-xs font-medium text-red-400">✗ {sharedWrite.beta.error}</p>
						{/if}
					{/if}
				</div>
			</div>
			<p class="mt-4 text-xs text-muted-foreground">
				Note: ทั้งสองปุ่มทดสอบ database เดียวกัน (demo_shared) — ต่างกันที่ field
				<code class="rounded bg-muted px-1 py-0.5">team</code> ใน document
			</p>
		</Card.Content>
	</Card.Root>
</div>

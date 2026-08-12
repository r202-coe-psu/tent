<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import { startStaffCouchSync } from '$lib/db/staff-couch-sync';
	import { authStore } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { LOGOUT_ROUTE } from '$lib/guards/auth';
	import { SessionExpiredBar } from '$lib/features/login';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	$effect(() => {
		if (!authStore.isAuthenticated || authStore.needsReauth) return;
		const sync = startStaffCouchSync(data.queryClient);
		return () => sync.stop();
	});

	async function logout() {
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve(LOGOUT_ROUTE));
	}
</script>

<ConnectionBanner />

<div class="flex h-[var(--app-shell-height)] flex-col overflow-hidden">
	{#if !page.url.pathname.startsWith('/back-office')}
		<header class="flex shrink-0 items-center justify-between border-b bg-background px-6 py-3">
			<a href={resolve('/portal')} class="font-semibold">Smart Shelter</a>
			<div class="flex items-center gap-4">
				<span class="text-sm text-muted-foreground">{authStore.user?.name}</span>
				<Separator orientation="vertical" class="h-4" />
				<Button variant="outline" size="sm" onclick={logout}>Logout</Button>
			</div>
		</header>
	{/if}

	<SessionExpiredBar />

	<main class="flex min-h-0 flex-1 flex-col overflow-y-auto">
		{@render children()}
	</main>
</div>

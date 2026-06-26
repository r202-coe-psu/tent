<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { authStore } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { LOGIN_ROUTE } from '$lib/guards/auth';
	import { isShelterManager, isSystemAdmin } from '$lib/auth/roles';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const canManageUsers = $derived(isSA || isShelterManager(roles));

	async function logout() {
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve(LOGIN_ROUTE));
	}
</script>

<div class="flex h-svh flex-col overflow-hidden">
	{#if !page.url.pathname.startsWith('/back-office')}
		<header class="flex shrink-0 items-center justify-between border-b bg-background px-6 py-3">
			<a href={resolve('/')} class="font-semibold">App</a>
			<div class="flex items-center gap-4">
				<span class="text-sm text-muted-foreground">{authStore.user?.name}</span>
				<Separator orientation="vertical" class="h-4" />
				<a href={resolve('/onsite/people')} class="text-sm hover:underline">People</a>
				{#if isSA}
					<Separator orientation="vertical" class="h-4" />
					<a href={resolve('/back-office/shelters')} class="text-sm hover:underline">Shelters</a>
				{/if}
				{#if canManageUsers}
					<a href={resolve('/back-office/users')} class="text-sm hover:underline">Users</a>
				{/if}
				<Separator orientation="vertical" class="h-4" />
				<Button variant="outline" size="sm" onclick={logout}>Logout</Button>
			</div>
		</header>
	{/if}

	{#if authStore.needsReauth}
		<div
			class="flex items-center justify-between gap-4 border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-900"
			role="status"
		>
			<span
				>Your session expired — changes are saved locally but won't sync until you log in again.</span
			>
			<a
				href={resolve('/login')}
				class="shrink-0 font-medium underline underline-offset-4 hover:text-amber-950"
			>
				Log in to sync
			</a>
		</div>
	{/if}

	<main class="flex min-h-0 flex-1 flex-col">
		{@render children()}
	</main>
</div>

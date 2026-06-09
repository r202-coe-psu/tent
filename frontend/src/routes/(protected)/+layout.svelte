<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { authStore } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	async function logout() {
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve('/login'));
	}
</script>

<div class="flex min-h-svh flex-col">
	<header class="flex items-center justify-between border-b px-6 py-3">
		<a href={resolve('/home')} class="font-semibold">App</a>
		<div class="flex items-center gap-4">
			<span class="text-sm text-muted-foreground">{authStore.user?.name}</span>
			<Separator orientation="vertical" class="h-4" />
			<a href={resolve('/demo')} class="text-sm hover:underline">RBAC Demo</a>
			<Separator orientation="vertical" class="h-4" />
			<a href={resolve('/shelter')} class="text-sm hover:underline">Shelter</a>
			{#if authStore.user?.roles.includes('_admin')}
				<Separator orientation="vertical" class="h-4" />
				<a href={resolve('/admin/users')} class="text-sm hover:underline">Admin</a>
				<Separator orientation="vertical" class="h-4" />
				<a href={resolve('/admin/demo')} class="text-sm hover:underline">Demo Setup</a>
				<Separator orientation="vertical" class="h-4" />
				<a href={resolve('/admin/shelter')} class="text-sm hover:underline">Shelter Setup</a>
			{/if}
			<Separator orientation="vertical" class="h-4" />
			<Button variant="outline" size="sm" onclick={logout}>Logout</Button>
		</div>
	</header>

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

	<main class="flex-1">
		{@render children()}
	</main>
</div>

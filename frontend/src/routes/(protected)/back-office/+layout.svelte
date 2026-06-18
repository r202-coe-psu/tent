<script lang="ts">
	import AdminSidebar from '$lib/components/admin-sidebar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="flex h-svh w-full overflow-hidden bg-muted/30 text-foreground">
	<AdminSidebar />
	<div class="flex h-full w-full flex-1 flex-col overflow-y-auto">
		{@render children()}
	</div>
</div>

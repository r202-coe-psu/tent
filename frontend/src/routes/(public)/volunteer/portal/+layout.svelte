<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import VolunteerPortalShell from '$lib/components/volunteer-portal-shell.svelte';
	import { PORTAL_SESSION_KEY, PORTAL_TOKEN_HANDOFF_KEY } from '$lib/features/volunteer-portal';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	beforeNavigate(({ to }) => {
		if (to?.url.pathname.startsWith('/volunteers/portal')) return;
		try {
			sessionStorage.removeItem(PORTAL_SESSION_KEY);
			sessionStorage.removeItem(PORTAL_TOKEN_HANDOFF_KEY);
		} catch {
			// Storage unavailable.
		}
	});
</script>

<VolunteerPortalShell>
	{@render children()}
</VolunteerPortalShell>

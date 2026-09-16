<script lang="ts">
	import type { LayoutProps } from './$types';
	import ShelterNavbar from '$lib/components/shelter-navbar.svelte';
	let { children }: LayoutProps = $props();
</script>

<!--
	--registration-sticky-top: protected app bar (h-14 / 3.5rem) + ShelterNavbar (h-[52px])
	= 6.75rem. StaffAccountMenu does not change header height. Keep in sync if either bar changes.
-->
<div
	class="flex w-full flex-1 flex-col items-stretch bg-muted/30 text-foreground"
	style="--registration-sticky-top: 6.75rem"
>
	<!-- z-40: above registration sticky chrome (spy nav z-30) so chips never cover the shelter bar -->
	<div class="sticky top-14 z-40">
		<ShelterNavbar />
	</div>
	<div class="w-full flex-1 flex-col">
		{@render children()}
	</div>
</div>

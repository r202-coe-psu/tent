<script lang="ts">
	import { LinkAccountForm } from '$lib/features/login';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex h-[var(--app-shell-height)] w-full items-center justify-center px-4">
	<div class="flex w-full max-w-md flex-col gap-4">
		<LinkAccountForm pending={data.pending} />
	</div>
</div>

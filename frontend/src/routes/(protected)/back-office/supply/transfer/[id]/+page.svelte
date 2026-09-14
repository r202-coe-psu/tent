<script lang="ts">
	import { TransferDetail } from '$lib/features/operations';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>รายละเอียดคำร้องโอนย้าย · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col bg-background p-3.5 sm:p-6">
	<TransferDetail id={data.id} />
</div>

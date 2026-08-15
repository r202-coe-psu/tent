<script lang="ts">
	import {
		ApiKeyList,
		CreateApiKeyDialog,
		RevealApiKeyDialog,
		RevokeApiKeyDialog,
		useApiKeys,
		type ApiKey,
		type CreatedApiKey
	} from '$lib/features/api-keys';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';

	const keysQuery = useApiKeys();

	let createOpen = $state(false);
	let revealOpen = $state(false);
	let revokeOpen = $state(false);
	let revealed = $state.raw<CreatedApiKey | null>(null);
	let revokeTarget = $state.raw<ApiKey | null>(null);

	const keys = $derived(keysQuery.data ?? []);

	function handleCreated(created: CreatedApiKey) {
		revealed = created;
		revealOpen = true;
	}

	function handleRevoke(key: ApiKey) {
		revokeTarget = key;
		revokeOpen = true;
	}
</script>

<svelte:head>
	<title>API Keys — SmartShelter</title>
</svelte:head>

<div class="mx-6 flex flex-1 flex-col gap-8 p-6 md:p-8">
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
		<div>
			<h2 class="text-3xl font-bold tracking-tight text-foreground">API Keys</h2>
			<p class="mt-2 text-muted-foreground">
				จัดการคีย์สำหรับหน่วยงานภายนอกที่เรียก
				<code class="rounded bg-muted px-1.5 py-0.5 text-sm">/external/v1/*</code>
				— คีย์เต็มแสดงครั้งเดียวตอนสร้างเท่านั้น
			</p>
		</div>
		<Button
			onclick={() => (createOpen = true)}
			class="shrink-0 bg-primary text-primary-foreground shadow-md transition-all hover:bg-primary/90"
		>
			<Plus class="mr-2 h-4 w-4" />
			Create API key
		</Button>
	</div>

	<div class="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
		{#if keysQuery.isLoading}
			<div class="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
				<div
					class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
				></div>
				<p>กำลังโหลดข้อมูล...</p>
			</div>
		{:else if keysQuery.isError}
			<div class="px-6 py-16 text-center text-sm text-destructive">
				{keysQuery.error instanceof Error ? keysQuery.error.message : 'Failed to load API keys'}
			</div>
		{:else}
			<ApiKeyList {keys} pending={false} onrevoke={handleRevoke} />
		{/if}
	</div>
</div>

<CreateApiKeyDialog bind:open={createOpen} oncreated={handleCreated} />
<RevealApiKeyDialog bind:open={revealOpen} created={revealed} />
<RevokeApiKeyDialog bind:open={revokeOpen} target={revokeTarget} />

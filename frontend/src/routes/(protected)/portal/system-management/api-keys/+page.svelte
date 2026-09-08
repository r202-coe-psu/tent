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
	import {
		CreateThirdPartyClientDialog,
		RevealThirdPartyClientSecretDialog,
		RevokeThirdPartyClientDialog,
		ThirdPartyClientList,
		useThirdPartyClients,
		type CreatedThirdPartyClient,
		type ThirdPartyClient
	} from '$lib/features/third-party-clients';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
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

	const clientsQuery = useThirdPartyClients();

	let createClientOpen = $state(false);
	let revealClientOpen = $state(false);
	let revokeClientOpen = $state(false);
	let revealedClient = $state.raw<CreatedThirdPartyClient | null>(null);
	let revokeClientTarget = $state.raw<ThirdPartyClient | null>(null);

	const clients = $derived(clientsQuery.data ?? []);

	function handleClientCreated(created: CreatedThirdPartyClient) {
		revealedClient = created;
		revealClientOpen = true;
	}

	function handleClientRevoke(thirdPartyClient: ThirdPartyClient) {
		revokeClientTarget = thirdPartyClient;
		revokeClientOpen = true;
	}
</script>

<svelte:head>
	<title>API Keys — SmartShelter</title>
</svelte:head>

<div class="mx-6 flex flex-1 flex-col gap-8 p-6 md:p-8">
	<div>
		<h2 class="text-3xl font-bold tracking-tight text-foreground">API Keys</h2>
		<p class="mt-2 text-muted-foreground">จัดการการเข้าถึงของหน่วยงานภายนอก</p>
	</div>

	<Tabs.Root value="external" class="gap-6">
		<Tabs.List>
			<Tabs.Trigger value="external">External API Keys</Tabs.Trigger>
			<Tabs.Trigger value="thirdparty">Partner OAuth2 Clients</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="external" class="flex flex-col gap-6">
			<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
				<p class="text-sm text-muted-foreground">
					จัดการคีย์สำหรับหน่วยงานภายนอกที่เรียก
					<code class="rounded bg-muted px-1.5 py-0.5 text-sm">/external/v1/*</code>
					— คีย์เต็มแสดงครั้งเดียวตอนสร้างเท่านั้น
				</p>
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
		</Tabs.Content>

		<Tabs.Content value="thirdparty" class="flex flex-col gap-6">
			<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
				<p class="text-sm text-muted-foreground">
					จัดการ OAuth2 client credentials สำหรับ M6/M7 ที่เรียก
					<code class="rounded bg-muted px-1.5 py-0.5 text-sm">/api/thirdparty/*</code>
					ผ่าน
					<code class="rounded bg-muted px-1.5 py-0.5 text-sm"
						>POST /api/auth/token-third-party</code
					>
					— secret เต็มแสดงครั้งเดียวตอนสร้างเท่านั้น
				</p>
				<Button
					onclick={() => (createClientOpen = true)}
					class="shrink-0 bg-primary text-primary-foreground shadow-md transition-all hover:bg-primary/90"
				>
					<Plus class="mr-2 h-4 w-4" />
					Create client
				</Button>
			</div>

			<div class="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
				{#if clientsQuery.isLoading}
					<div class="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
						<div
							class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
						></div>
						<p>กำลังโหลดข้อมูล...</p>
					</div>
				{:else if clientsQuery.isError}
					<div class="px-6 py-16 text-center text-sm text-destructive">
						{clientsQuery.error instanceof Error
							? clientsQuery.error.message
							: 'Failed to load third-party clients'}
					</div>
				{:else}
					<ThirdPartyClientList {clients} pending={false} onrevoke={handleClientRevoke} />
				{/if}
			</div>
		</Tabs.Content>
	</Tabs.Root>
</div>

<CreateApiKeyDialog bind:open={createOpen} oncreated={handleCreated} />
<RevealApiKeyDialog bind:open={revealOpen} created={revealed} />
<RevokeApiKeyDialog bind:open={revokeOpen} target={revokeTarget} />

<CreateThirdPartyClientDialog bind:open={createClientOpen} oncreated={handleClientCreated} />
<RevealThirdPartyClientSecretDialog bind:open={revealClientOpen} created={revealedClient} />
<RevokeThirdPartyClientDialog bind:open={revokeClientOpen} target={revokeClientTarget} />

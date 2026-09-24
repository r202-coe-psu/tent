<script lang="ts">
	import {
		CreateThirdPartyClientDialog,
		DeleteThirdPartyClientDialog,
		EditThirdPartyClientScopesDialog,
		RegenerateThirdPartyClientSecretDialog,
		RevealThirdPartyClientSecretDialog,
		RevokeThirdPartyClientDialog,
		ThirdPartyClientList,
		ViewThirdPartyClientSecretDialog,
		useThirdPartyClients,
		type CreatedThirdPartyClient,
		type ThirdPartyClient
	} from '$lib/features/third-party-clients';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import ExternalApiKeysPanel from './external-api-keys-panel.svelte';

	/**
	 * External API Keys (`/external/v1/*`, CR-062) tab is hidden and unmounted for now
	 * (CR-135 FR-1/FR-2) — flip to re-enable.
	 */
	const EXTERNAL_API_KEYS_ENABLED = false;

	const clientsQuery = useThirdPartyClients();

	let createClientOpen = $state(false);
	let revealClientOpen = $state(false);
	let revokeClientOpen = $state(false);
	let editScopesOpen = $state(false);
	let viewSecretOpen = $state(false);
	let deleteClientOpen = $state(false);
	let regenerateClientOpen = $state(false);
	let revealedClient = $state.raw<CreatedThirdPartyClient | null>(null);
	let revokeClientTarget = $state.raw<ThirdPartyClient | null>(null);
	let editScopesTarget = $state.raw<ThirdPartyClient | null>(null);
	let viewSecretTarget = $state.raw<ThirdPartyClient | null>(null);
	let deleteClientTarget = $state.raw<ThirdPartyClient | null>(null);
	let regenerateClientTarget = $state.raw<ThirdPartyClient | null>(null);

	const clients = $derived(clientsQuery.data ?? []);

	function handleClientCreated(created: CreatedThirdPartyClient) {
		revealedClient = created;
		revealClientOpen = true;
	}

	function handleClientRevoke(thirdPartyClient: ThirdPartyClient) {
		revokeClientTarget = thirdPartyClient;
		revokeClientOpen = true;
	}

	function handleClientEdit(thirdPartyClient: ThirdPartyClient) {
		editScopesTarget = thirdPartyClient;
		editScopesOpen = true;
	}

	function handleClientViewSecret(thirdPartyClient: ThirdPartyClient) {
		viewSecretTarget = thirdPartyClient;
		viewSecretOpen = true;
	}

	function handleClientDelete(thirdPartyClient: ThirdPartyClient) {
		deleteClientTarget = thirdPartyClient;
		deleteClientOpen = true;
	}

	function handleClientRegenerate(thirdPartyClient: ThirdPartyClient) {
		regenerateClientTarget = thirdPartyClient;
		regenerateClientOpen = true;
	}

	function handleClientRegenerated(regenerated: CreatedThirdPartyClient) {
		revealedClient = regenerated;
		revealClientOpen = true;
	}
</script>

<svelte:head>
	<title>API Keys — SmartShelter</title>
</svelte:head>

<StaffPageShell title="API Keys" description="จัดการการเข้าถึงของหน่วยงานภายนอก">
	{#snippet actions()}
		<Button onclick={() => (createClientOpen = true)} class="btn-primary-brand shrink-0">
			<Plus class="mr-2 h-4 w-4" />
			Create client
		</Button>
	{/snippet}

	{#if EXTERNAL_API_KEYS_ENABLED}
		<Tabs.Root value="thirdparty" class="gap-6">
			<Tabs.List>
				<Tabs.Trigger value="external">External API Keys</Tabs.Trigger>
				<Tabs.Trigger value="thirdparty">Partner OAuth2 Clients</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="external" class="flex flex-col gap-6">
				<ExternalApiKeysPanel />
			</Tabs.Content>

			<Tabs.Content value="thirdparty" class="flex flex-col gap-6">
				<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
					<p class="text-sm text-slate-600">
						จัดการ OAuth2 client credentials สำหรับ M6/M7 ที่เรียก
						<code class="rounded bg-muted px-1.5 py-0.5 text-sm">/external/*</code>
						ผ่าน
						<code class="rounded bg-muted px-1.5 py-0.5 text-sm">POST /external/token</code>
						— secret เต็มแสดงครั้งเดียวตอนสร้างเท่านั้น
					</p>
					<Button onclick={() => (createClientOpen = true)} class="btn-primary-brand shrink-0">
						<Plus class="mr-2 h-4 w-4" />
						Create client
					</Button>
				</div>

				<div class={spatial.container.staffPageCard}>
					{#if clientsQuery.isLoading}
						<div
							class="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground"
						>
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
						<ThirdPartyClientList
							{clients}
							pending={false}
							onrevoke={handleClientRevoke}
							onedit={handleClientEdit}
							onviewsecret={handleClientViewSecret}
							onregenerate={handleClientRegenerate}
							ondelete={handleClientDelete}
						/>
					{/if}
				</div>
			</Tabs.Content>
		</Tabs.Root>
	{:else}
		<p class="text-sm text-slate-600">
			จัดการ OAuth2 client credentials สำหรับ M6/M7 ที่เรียก
			<code class="rounded bg-muted px-1.5 py-0.5 text-sm">/external/*</code>
			ผ่าน
			<code class="rounded bg-muted px-1.5 py-0.5 text-sm">POST /external/token</code>
			— secret เต็มแสดงครั้งเดียวตอนสร้างเท่านั้น
		</p>

		<div class={spatial.container.staffPageCard}>
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
				<ThirdPartyClientList
					{clients}
					pending={false}
					onrevoke={handleClientRevoke}
					onedit={handleClientEdit}
					onviewsecret={handleClientViewSecret}
					onregenerate={handleClientRegenerate}
					ondelete={handleClientDelete}
				/>
			{/if}
		</div>
	{/if}
</StaffPageShell>

<CreateThirdPartyClientDialog bind:open={createClientOpen} oncreated={handleClientCreated} />
<RevealThirdPartyClientSecretDialog bind:open={revealClientOpen} created={revealedClient} />
<RevokeThirdPartyClientDialog bind:open={revokeClientOpen} target={revokeClientTarget} />
<EditThirdPartyClientScopesDialog bind:open={editScopesOpen} target={editScopesTarget} />
<ViewThirdPartyClientSecretDialog bind:open={viewSecretOpen} target={viewSecretTarget} />
<DeleteThirdPartyClientDialog bind:open={deleteClientOpen} target={deleteClientTarget} />
<RegenerateThirdPartyClientSecretDialog
	bind:open={regenerateClientOpen}
	target={regenerateClientTarget}
	onregenerated={handleClientRegenerated}
/>

<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import Ban from '@lucide/svelte/icons/ban';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import type { ThirdPartyClient } from '../domain/third-party-client';

	let {
		clients,
		pending = false,
		onrevoke
	}: {
		clients: ThirdPartyClient[];
		pending?: boolean;
		onrevoke: (client: ThirdPartyClient) => void;
	} = $props();

	function formatDate(iso: string): string {
		const ms = Date.parse(iso);
		if (Number.isNaN(ms)) return iso;
		return new Date(ms).toLocaleDateString('th-TH', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

{#if clients.length === 0}
	<div class="flex flex-col items-center justify-center gap-4 px-6 py-16 text-muted-foreground">
		<div class="rounded-full bg-muted p-4">
			<KeyRound class="h-8 w-8" />
		</div>
		<div class="text-center">
			<h3 class="text-lg font-semibold text-foreground">ยังไม่มี Partner Client</h3>
			<p class="mt-1 text-sm">สร้าง OAuth2 client สำหรับ M6/M7 ที่เรียก /api/thirdparty/*</p>
		</div>
	</div>
{:else}
	<Table.Root class="w-full">
		<Table.Header class="bg-muted/50">
			<Table.Row class="hover:bg-transparent">
				<Table.Head class="font-semibold text-foreground">Client ID</Table.Head>
				<Table.Head class="font-semibold text-foreground">Name</Table.Head>
				<Table.Head class="font-semibold text-foreground">Scopes</Table.Head>
				<Table.Head class="font-semibold text-foreground">Created</Table.Head>
				<Table.Head class="font-semibold text-foreground">Status</Table.Head>
				<Table.Head class="text-right font-semibold text-foreground">จัดการ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each clients as thirdPartyClient (thirdPartyClient.id)}
				<Table.Row class="hover:bg-muted/30">
					<Table.Cell class="font-medium">
						<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
							>{thirdPartyClient.client_id}</code
						>
					</Table.Cell>
					<Table.Cell>{thirdPartyClient.module_name}</Table.Cell>
					<Table.Cell>
						<div class="flex flex-wrap gap-1">
							{#each thirdPartyClient.allowed_scopes as scope (scope)}
								<Badge variant="outline" class="font-mono text-[11px]">{scope}</Badge>
							{/each}
						</div>
					</Table.Cell>
					<Table.Cell>{formatDate(thirdPartyClient.created_at)}</Table.Cell>
					<Table.Cell>
						{#if thirdPartyClient.is_active}
							<Badge
								variant="secondary"
								class="rounded-md bg-emerald-50 font-semibold text-emerald-800 hover:bg-emerald-50"
							>
								Active
							</Badge>
						{:else}
							<Badge
								variant="secondary"
								class="rounded-md bg-slate-100 font-semibold text-slate-600 hover:bg-slate-100"
							>
								Revoked
							</Badge>
						{/if}
					</Table.Cell>
					<Table.Cell class="text-right">
						{#if thirdPartyClient.is_active}
							<Button
								variant="outline"
								size="sm"
								class="border-red-100 text-red-600 hover:bg-red-50"
								disabled={pending}
								onclick={() => onrevoke(thirdPartyClient)}
							>
								<Ban class="mr-1 h-3.5 w-3.5" />
								Revoke
							</Button>
						{:else}
							<span class="text-xs text-muted-foreground">—</span>
						{/if}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}

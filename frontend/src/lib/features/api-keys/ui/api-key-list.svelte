<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import Ban from '@lucide/svelte/icons/ban';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import {
		API_KEY_STATUS_LABEL,
		apiKeyStatus,
		type ApiKey,
		type ApiKeyStatus
	} from '../domain/api-key';

	let {
		keys,
		pending = false,
		onrevoke
	}: {
		keys: ApiKey[];
		pending?: boolean;
		onrevoke: (key: ApiKey) => void;
	} = $props();

	const statusClass: Record<ApiKeyStatus, string> = {
		active: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-50',
		expired: 'bg-amber-50 text-amber-800 hover:bg-amber-50',
		revoked: 'bg-slate-100 text-slate-600 hover:bg-slate-100'
	};

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

{#if keys.length === 0}
	<div class="flex flex-col items-center justify-center gap-4 px-6 py-16 text-muted-foreground">
		<div class="rounded-full bg-muted p-4">
			<KeyRound class="h-8 w-8" />
		</div>
		<div class="text-center">
			<h3 class="text-lg font-semibold text-foreground">ยังไม่มี API Key</h3>
			<p class="mt-1 text-sm">สร้างคีย์สำหรับหน่วยงานภายนอกที่เรียก /external/v1/*</p>
		</div>
	</div>
{:else}
	<Table.Root class="w-full">
		<Table.Header class="bg-muted/50">
			<Table.Row class="hover:bg-transparent">
				<Table.Head class="font-semibold text-foreground">Name</Table.Head>
				<Table.Head class="font-semibold text-foreground">Owner</Table.Head>
				<Table.Head class="font-semibold text-foreground">Prefix</Table.Head>
				<Table.Head class="font-semibold text-foreground">Expires</Table.Head>
				<Table.Head class="font-semibold text-foreground">Status</Table.Head>
				<Table.Head class="font-semibold text-foreground">Created by</Table.Head>
				<Table.Head class="text-right font-semibold text-foreground">จัดการ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each keys as key (key.id)}
				{@const status = apiKeyStatus(key)}
				<Table.Row class="hover:bg-muted/30">
					<Table.Cell class="font-medium">{key.name}</Table.Cell>
					<Table.Cell>{key.owner}</Table.Cell>
					<Table.Cell>
						<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{key.key_prefix}</code>
					</Table.Cell>
					<Table.Cell>{formatDate(key.expires_at)}</Table.Cell>
					<Table.Cell>
						<Badge variant="secondary" class="rounded-md font-semibold {statusClass[status]}">
							{API_KEY_STATUS_LABEL[status]}
						</Badge>
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">{key.created_by}</Table.Cell>
					<Table.Cell class="text-right">
						{#if status === 'active'}
							<Button
								variant="outline"
								size="sm"
								class="border-red-100 text-red-600 hover:bg-red-50"
								disabled={pending}
								onclick={() => onrevoke(key)}
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

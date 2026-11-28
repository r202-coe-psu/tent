<script lang="ts">
	import Ban from '@lucide/svelte/icons/ban';
	import Eye from '@lucide/svelte/icons/eye';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { formatThaiShortDate } from '$lib/utils/date';
	import {
		partnerModuleLabel,
		thirdPartyClientDisplayName,
		type ThirdPartyClient
	} from '../domain/third-party-client';
	import ThirdPartyClientStatusBadge from './third-party-client-status-badge.svelte';
	import ThirdPartyScopeTags from './third-party-scope-tags.svelte';

	let {
		clients,
		pending = false,
		selectedId = null,
		onselect,
		onrevoke,
		onedit,
		onviewsecret,
		onregenerate,
		ondelete,
		oncreate
	}: {
		clients: ThirdPartyClient[];
		pending?: boolean;
		selectedId?: string | null;
		onselect: (client: ThirdPartyClient) => void;
		onrevoke: (client: ThirdPartyClient) => void;
		onedit: (client: ThirdPartyClient) => void;
		onviewsecret: (client: ThirdPartyClient) => void;
		onregenerate: (client: ThirdPartyClient) => void;
		ondelete: (client: ThirdPartyClient) => void;
		oncreate?: () => void;
	} = $props();

	function formatDate(iso: string): string {
		return formatThaiShortDate(iso) || iso;
	}

	function onRowKeydown(event: KeyboardEvent, client: ThirdPartyClient) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest('[data-slot="dropdown-menu-trigger"], [data-slot="dropdown-menu-content"]')
		) {
			return;
		}
		event.preventDefault();
		onselect(client);
	}
</script>

{#if clients.length === 0}
	<div class="flex flex-col items-center justify-center gap-4 px-6 py-16">
		<div class="rounded-full border border-slate-200 bg-slate-50 p-4">
			<KeyRound class="size-8 text-slate-500" />
		</div>
		<h3 class="text-lg font-semibold text-slate-900">ยังไม่มีคีย์พันธมิตร</h3>
		{#if oncreate}
			<Button type="button" class="btn-primary-brand h-11" onclick={oncreate}>
				<Plus class="size-4" />
				สร้างคีย์
			</Button>
		{/if}
	</div>
{:else}
	<Table.Root>
		<Table.Header class="bg-slate-50">
			<Table.Row class="hover:bg-transparent">
				<Table.Head class="text-sm font-semibold text-slate-700">พันธมิตร</Table.Head>
				<Table.Head class="text-sm font-semibold text-slate-700">โมดูล</Table.Head>
				<Table.Head class="text-sm font-semibold text-slate-700">สิทธิ์ที่อนุมัติ</Table.Head>
				<Table.Head class="text-sm font-semibold text-slate-700">สถานะ</Table.Head>
				<Table.Head class="text-sm font-semibold text-slate-700">อัปเดต</Table.Head>
				<Table.Head class="text-right text-sm font-semibold text-slate-700">จัดการ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each clients as thirdPartyClient (thirdPartyClient.id)}
				<Table.Row
					tabindex={0}
					data-state={selectedId === thirdPartyClient.id ? 'selected' : undefined}
					class="cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none focus-visible:ring-inset"
					aria-label={`ดูรายละเอียด ${thirdPartyClientDisplayName(thirdPartyClient)}`}
					onclick={() => onselect(thirdPartyClient)}
					onkeydown={(event) => onRowKeydown(event, thirdPartyClient)}
				>
					<Table.Cell class="max-w-64 align-top whitespace-normal">
						<div class="font-medium text-slate-900">
							{thirdPartyClientDisplayName(thirdPartyClient)}
						</div>
						<p class="mt-0.5 font-mono text-sm text-slate-500">{thirdPartyClient.client_id}</p>
						{#if thirdPartyClient.description}
							<p class="mt-0.5 line-clamp-1 text-sm text-slate-600">
								{thirdPartyClient.description}
							</p>
						{/if}
					</Table.Cell>
					<Table.Cell class="align-top text-sm text-slate-700">
						{partnerModuleLabel(thirdPartyClient.module_name)}
					</Table.Cell>
					<Table.Cell class="max-w-md align-top whitespace-normal">
						<ThirdPartyScopeTags scopes={thirdPartyClient.allowed_scopes} />
					</Table.Cell>
					<Table.Cell class="align-top">
						<ThirdPartyClientStatusBadge active={thirdPartyClient.is_active} />
					</Table.Cell>
					<Table.Cell class="align-top text-sm text-slate-700 tabular-nums">
						{formatDate(thirdPartyClient.updated_at)}
					</Table.Cell>
					<Table.Cell class="text-right align-top" onclick={(event) => event.stopPropagation()}>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
							>
								<MoreHorizontal class="size-4" />
								<span class="sr-only">
									จัดการ {thirdPartyClientDisplayName(thirdPartyClient)}
								</span>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="min-w-52">
								<DropdownMenu.Item class="min-h-11" onSelect={() => onselect(thirdPartyClient)}>
									<Eye />
									ดูรายละเอียด
								</DropdownMenu.Item>
								<DropdownMenu.Item
									class="min-h-11"
									disabled={pending}
									onSelect={() => onviewsecret(thirdPartyClient)}
								>
									<KeyRound />
									ดู secret
								</DropdownMenu.Item>
								{#if thirdPartyClient.is_active}
									<DropdownMenu.Item
										class="min-h-11"
										disabled={pending}
										onSelect={() => onedit(thirdPartyClient)}
									>
										<Pencil />
										แก้ไขสิทธิ์
									</DropdownMenu.Item>
									<DropdownMenu.Item
										class="min-h-11"
										disabled={pending}
										onSelect={() => onregenerate(thirdPartyClient)}
									>
										<RefreshCw />
										สร้าง secret ใหม่
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										variant="destructive"
										class="min-h-11"
										disabled={pending}
										onSelect={() => onrevoke(thirdPartyClient)}
									>
										<Ban />
										เพิกถอน
									</DropdownMenu.Item>
								{:else}
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										variant="destructive"
										class="min-h-11"
										disabled={pending}
										onSelect={() => ondelete(thirdPartyClient)}
									>
										<Trash2 />
										ลบ
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}

<script lang="ts">
	import Ban from '@lucide/svelte/icons/ban';
	import Copy from '@lucide/svelte/icons/copy';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { formatThaiShortDate } from '$lib/utils/date';
	import {
		SENSITIVE_SCOPE_WARNING,
		isSensitiveScope,
		partnerModuleLabel,
		scopeShortLabel,
		thirdPartyClientDisplayName,
		type GrantableScope,
		type ThirdPartyClient
	} from '../domain/third-party-client';
	import ThirdPartyClientStatusBadge from './third-party-client-status-badge.svelte';
	import ThirdPartyScopeTags from './third-party-scope-tags.svelte';

	let {
		client,
		onOpenChange,
		onviewsecret,
		onedit,
		onregenerate,
		onrevoke,
		ondelete
	}: {
		client: ThirdPartyClient | null;
		onOpenChange: (open: boolean) => void;
		onviewsecret: (client: ThirdPartyClient) => void;
		onedit: (client: ThirdPartyClient) => void;
		onregenerate: (client: ThirdPartyClient) => void;
		onrevoke: (client: ThirdPartyClient) => void;
		ondelete: (client: ThirdPartyClient) => void;
	} = $props();

	const generalScopes = $derived(
		client?.allowed_scopes.filter((scope) => !isSensitiveScope(scope)) ?? []
	);
	const sensitiveScopes = $derived(
		client?.allowed_scopes.filter((scope) => isSensitiveScope(scope)) ?? []
	);

	function formatDate(iso: string): string {
		return formatThaiShortDate(iso) || iso;
	}

	function sensitiveScopeWarning(scope: string): string | undefined {
		if (!isSensitiveScope(scope)) return undefined;
		return SENSITIVE_SCOPE_WARNING[scope as GrantableScope];
	}

	function run(action: (current: ThirdPartyClient) => void) {
		if (client) action(client);
	}

	async function copyClientId() {
		if (!client) return;
		const clientId = client.client_id;
		try {
			await navigator.clipboard.writeText(clientId);
			toast.success('คัดลอก client id แล้ว');
		} catch {
			toast.error('ไม่สามารถคัดลอกได้');
		}
	}
</script>

<Sheet.Root
	open={client !== null}
	onOpenChange={(next) => {
		if (!next) onOpenChange(false);
	}}
>
	<Sheet.Content side="right" class="w-full gap-0 overflow-hidden p-0 shadow-xs sm:max-w-md">
		{#if client}
			<div class="flex h-full min-h-0 flex-col">
				<Sheet.Header class="space-y-2 border-b border-slate-200/80 p-4 pr-14 text-left">
					<Sheet.Title class="text-lg font-bold text-slate-900">
						{thirdPartyClientDisplayName(client)}
					</Sheet.Title>
					<Sheet.Description class="text-sm text-slate-600">
						{partnerModuleLabel(client.module_name)}
					</Sheet.Description>
					<div>
						<ThirdPartyClientStatusBadge active={client.is_active} />
					</div>
				</Sheet.Header>

				<div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
					<section class="space-y-3">
						<h2 class="text-sm font-semibold text-slate-800">ข้อมูลคีย์</h2>
						<div class="space-y-1.5">
							<p class="text-sm font-semibold text-slate-700">client id</p>
							<div
								class="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50 p-2"
							>
								<code class="min-w-0 flex-1 font-mono text-sm break-all text-slate-800">
									{client.client_id}
								</code>
								<Button
									type="button"
									variant="outline"
									class="h-11 min-w-11 shrink-0 px-0"
									aria-label="คัดลอก client id"
									onclick={copyClientId}
								>
									<Copy />
								</Button>
							</div>
						</div>
						<div class="space-y-1">
							<h3 class="text-sm font-semibold text-slate-800">คำอธิบาย</h3>
							<p
								class={[
									'text-sm whitespace-pre-wrap',
									client.description ? 'text-slate-700' : 'text-slate-500'
								]}
							>
								{client.description || 'ไม่มีคำอธิบาย'}
							</p>
						</div>
						<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
							<dt class="text-slate-500">สร้างเมื่อ</dt>
							<dd class="text-slate-900 tabular-nums">{formatDate(client.created_at)}</dd>
							<dt class="text-slate-500">อัปเดตเมื่อ</dt>
							<dd class="text-slate-900 tabular-nums">{formatDate(client.updated_at)}</dd>
						</dl>
					</section>

					<section class="space-y-3">
						<h2 class="text-sm font-semibold text-slate-800">สิทธิ์ที่อนุมัติ</h2>
						<ThirdPartyScopeTags scopes={client.allowed_scopes} />

						{#if generalScopes.length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold text-slate-800">สิทธิ์ทั่วไป</h3>
								<ul class="space-y-2">
									{#each generalScopes as scope (scope)}
										<li class="rounded-lg border border-slate-200/80 bg-white px-3 py-2">
											<p class="font-mono text-sm break-all text-slate-800">{scope}</p>
											<p class="text-sm text-slate-600">{scopeShortLabel(scope)}</p>
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if sensitiveScopes.length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold text-amber-900">สิทธิ์ข้อมูลส่วนบุคคล</h3>
								<ul class="space-y-2">
									{#each sensitiveScopes as scope (scope)}
										{@const warning = sensitiveScopeWarning(scope)}
										<li class="rounded-xl border border-amber-200 bg-amber-50 p-3">
											<div class="flex items-start gap-2">
												<ShieldAlert
													class="mt-0.5 size-4 shrink-0 text-amber-700"
													aria-hidden="true"
												/>
												<div class="min-w-0 space-y-1">
													<p class="font-mono text-sm break-all text-amber-950">{scope}</p>
													<p class="text-sm font-semibold text-amber-900">
														{scopeShortLabel(scope)}
													</p>
													{#if warning}
														<p class="text-sm leading-relaxed text-amber-900">{warning}</p>
													{/if}
												</div>
											</div>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</section>
				</div>

				<Sheet.Footer class="border-t border-slate-200/80 bg-white">
					<Button
						type="button"
						variant="outline"
						class="h-11 w-full"
						onclick={() => run(onviewsecret)}
					>
						<KeyRound />
						ดู secret
					</Button>
					{#if client.is_active}
						<Button type="button" variant="outline" class="h-11 w-full" onclick={() => run(onedit)}>
							<Pencil />
							แก้ไขสิทธิ์
						</Button>
						<Button
							type="button"
							variant="outline"
							class="h-11 w-full"
							onclick={() => run(onregenerate)}
						>
							<RefreshCw />
							สร้าง secret ใหม่
						</Button>
						<Button
							type="button"
							variant="destructive"
							class="h-11 w-full"
							onclick={() => run(onrevoke)}
						>
							<Ban />
							เพิกถอน
						</Button>
					{:else}
						<Button
							type="button"
							variant="destructive"
							class="h-11 w-full"
							onclick={() => run(ondelete)}
						>
							<Trash2 />
							ลบ
						</Button>
					{/if}
				</Sheet.Footer>
			</div>
		{:else}
			<Sheet.Header class="sr-only">
				<Sheet.Title>รายละเอียดคีย์พันธมิตร</Sheet.Title>
				<Sheet.Description>ไม่ได้เลือกคีย์</Sheet.Description>
			</Sheet.Header>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<script lang="ts">
	import Ban from '@lucide/svelte/icons/ban';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import X from '@lucide/svelte/icons/x';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		CreateThirdPartyClientDialog,
		DeleteThirdPartyClientDialog,
		EditThirdPartyClientScopesDialog,
		RegenerateThirdPartyClientSecretDialog,
		RevealThirdPartyClientSecretDialog,
		RevokeThirdPartyClientDialog,
		ThirdPartyClientDetailSheet,
		ThirdPartyClientList,
		ViewThirdPartyClientSecretDialog,
		clientHasSensitiveScope,
		filterThirdPartyClients,
		useThirdPartyClients,
		type CreatedThirdPartyClient,
		type ThirdPartyClient,
		type ThirdPartyClientStatusFilter
	} from '$lib/features/third-party-clients';
	import { spatial } from '$lib/tokens';

	const STATUS_FILTERS: { value: ThirdPartyClientStatusFilter; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		{ value: 'active', label: 'ใช้งานอยู่' },
		{ value: 'revoked', label: 'เพิกถอนแล้ว' }
	];

	const PAGE_SIZE = 10;

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
	let query = $state('');
	let status = $state<ThirdPartyClientStatusFilter>('all');
	let sensitiveOnly = $state(false);
	let selectedId = $state<string | null>(null);
	let currentPage = $state(1);

	const clients = $derived(clientsQuery.data ?? []);
	const filteredClients = $derived(
		filterThirdPartyClients(clients, { query, status, sensitiveOnly })
	);
	const totalPages = $derived(Math.max(1, Math.ceil(filteredClients.length / PAGE_SIZE)));
	const clampedPage = $derived(Math.max(1, Math.min(currentPage, totalPages)));
	const pageClients = $derived(
		filteredClients.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)
	);
	const rangeStart = $derived(filteredClients.length === 0 ? 0 : (clampedPage - 1) * PAGE_SIZE + 1);
	const rangeEnd = $derived(Math.min(clampedPage * PAGE_SIZE, filteredClients.length));
	const selectedClient = $derived(
		selectedId === null ? null : (clients.find((client) => client.id === selectedId) ?? null)
	);
	const filtersActive = $derived(query.trim() !== '' || status !== 'all' || sensitiveOnly);
	const summary = $derived.by(() => {
		let active = 0;
		let revoked = 0;
		let sensitiveActive = 0;
		for (const client of clients) {
			if (client.is_active) {
				active += 1;
				if (clientHasSensitiveScope(client)) sensitiveActive += 1;
			} else {
				revoked += 1;
			}
		}
		return { total: clients.length, active, revoked, sensitiveActive };
	});

	function clearFilters() {
		query = '';
		status = 'all';
		sensitiveOnly = false;
		currentPage = 1;
	}

	function setSensitiveOnly(checked: boolean | 'indeterminate') {
		sensitiveOnly = checked === true;
		currentPage = 1;
	}

	function selectStatus(next: ThirdPartyClientStatusFilter) {
		status = next;
		currentPage = 1;
	}

	function handleSelect(client: ThirdPartyClient) {
		selectedId = client.id;
	}

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
	<title>คีย์หน่วยงานพันธมิตร — SmartShelter</title>
</svelte:head>

<StaffPageShell
	title="คีย์หน่วยงานพันธมิตร"
	description="ออก client credentials ให้ M2 / M6 / M7 เรียก /external/* — secret แสดงตอนสร้าง และดูซ้ำได้หลังยืนยันรหัสผ่าน"
>
	{#snippet actions()}
		<Button
			type="button"
			onclick={() => (createClientOpen = true)}
			class="btn-primary-brand h-11 shrink-0"
		>
			<Plus class="size-4" />
			สร้างคีย์
		</Button>
	{/snippet}

	{#if clientsQuery.isLoading}
		<div class={spatial.container.staffPageCard}>
			<div class="flex flex-col items-center justify-center gap-3 py-24 text-slate-500">
				<div
					class="size-8 animate-spin rounded-full border-4 border-slate-300 border-t-transparent"
				></div>
				<p class="text-sm">กำลังโหลดข้อมูล...</p>
			</div>
		</div>
	{:else if clientsQuery.isError}
		<div class={spatial.container.staffPageCard}>
			<div class="px-6 py-16 text-center text-sm text-red-700">
				{clientsQuery.error instanceof Error
					? clientsQuery.error.message
					: 'Failed to load third-party clients'}
			</div>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
			<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
				<div class="flex items-start gap-2">
					<KeyRound class="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
					<span class="text-sm font-semibold text-slate-600">ทั้งหมด</span>
				</div>
				<p class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{summary.total}</p>
			</div>
			<div class="rounded-xl border border-emerald-200 bg-white p-4 shadow-2xs">
				<div class="flex items-start gap-2">
					<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
					<span class="text-sm font-semibold text-emerald-900">ใช้งานอยู่</span>
				</div>
				<p class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{summary.active}</p>
			</div>
			<div class="rounded-xl border border-slate-300 bg-white p-4 shadow-2xs">
				<div class="flex items-start gap-2">
					<Ban class="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
					<span class="text-sm font-semibold text-slate-700">เพิกถอนแล้ว</span>
				</div>
				<p class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{summary.revoked}</p>
			</div>
			<div class="rounded-xl border border-amber-200 bg-white p-4 shadow-2xs">
				<div class="flex items-start gap-2">
					<ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
					<span class="text-sm font-semibold text-amber-900">ข้อมูลส่วนบุคคล</span>
				</div>
				<p class="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{summary.sensitiveActive}</p>
			</div>
		</div>

		<div class={spatial.container.staffPageCard}>
			<div class="flex flex-col gap-3 border-b border-slate-200/80 bg-white p-3 sm:p-4">
				<div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
					<div class="relative w-full xl:max-w-md">
						<Search
							class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
						/>
						<Input
							type="text"
							placeholder="ค้นหาชื่อ, client id, คำอธิบาย, scope"
							aria-label="ค้นหาคีย์พันธมิตร"
							bind:value={query}
							oninput={() => (currentPage = 1)}
							class="h-11 rounded-lg border-slate-200/80 bg-white pr-12 pl-10 text-sm placeholder:text-sm"
						/>
						{#if query}
							<Button
								type="button"
								variant="ghost"
								onclick={() => {
									query = '';
									currentPage = 1;
								}}
								class="absolute top-1/2 right-0 h-11 min-w-11 -translate-y-1/2 px-0 text-slate-400 hover:text-slate-700"
								aria-label="ล้างคำค้นหา"
							>
								<X class="size-4" />
							</Button>
						{/if}
					</div>

					<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
						<div
							class="inline-flex flex-wrap rounded-lg border border-slate-200/80 bg-slate-50 p-1"
							role="tablist"
							aria-label="กรองตามสถานะ"
						>
							{#each STATUS_FILTERS as option (option.value)}
								<button
									type="button"
									role="tab"
									aria-selected={status === option.value}
									onclick={() => selectStatus(option.value)}
									class={[
										'min-h-11 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none',
										status === option.value
											? 'bg-white font-semibold text-slate-900 shadow-2xs'
											: 'text-slate-600 hover:text-slate-900'
									]}
								>
									{option.label}
								</button>
							{/each}
						</div>

						<div class="flex min-h-11 items-center gap-2">
							<Checkbox
								id="partner-keys-sensitive-only"
								checked={sensitiveOnly}
								onCheckedChange={setSensitiveOnly}
							/>
							<Label
								for="partner-keys-sensitive-only"
								class="cursor-pointer text-sm font-semibold text-slate-700"
							>
								เฉพาะสิทธิ์ข้อมูลส่วนบุคคล
							</Label>
						</div>
					</div>
				</div>

				{#if filtersActive}
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-sm text-slate-600">
							ตรงเงื่อนไข
							<span class="font-semibold text-slate-900 tabular-nums">{filteredClients.length}</span
							>
						</p>
						<Button type="button" variant="ghost" class="h-11" onclick={clearFilters}>
							ล้างตัวกรอง
						</Button>
					</div>
				{/if}
			</div>

			{#if clients.length === 0 && !filtersActive}
				<ThirdPartyClientList
					clients={[]}
					{selectedId}
					onselect={handleSelect}
					oncreate={() => (createClientOpen = true)}
					pending={false}
					onrevoke={handleClientRevoke}
					onedit={handleClientEdit}
					onviewsecret={handleClientViewSecret}
					onregenerate={handleClientRegenerate}
					ondelete={handleClientDelete}
				/>
			{:else if filteredClients.length === 0}
				<div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
					<p class="text-base font-semibold text-slate-900">ไม่พบที่ตรงเงื่อนไข</p>
					<Button type="button" variant="outline" class="h-11" onclick={clearFilters}>
						ล้างตัวกรอง
					</Button>
				</div>
			{:else}
				<ThirdPartyClientList
					clients={pageClients}
					{selectedId}
					onselect={handleSelect}
					pending={false}
					onrevoke={handleClientRevoke}
					onedit={handleClientEdit}
					onviewsecret={handleClientViewSecret}
					onregenerate={handleClientRegenerate}
					ondelete={handleClientDelete}
				/>
				<div
					class="flex flex-col gap-3 border-t border-slate-200/80 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
				>
					<p class="text-sm text-slate-600 tabular-nums">
						แสดง {rangeStart}–{rangeEnd} จาก {filteredClients.length}
					</p>
					<PaginationControls
						bind:page={() => clampedPage, (page) => (currentPage = page)}
						count={filteredClients.length}
						perPage={PAGE_SIZE}
						class="h-11 min-w-11 text-sm"
					/>
				</div>
			{/if}
		</div>
	{/if}
</StaffPageShell>

<ThirdPartyClientDetailSheet
	client={selectedClient}
	onOpenChange={(open) => {
		if (!open) selectedId = null;
	}}
	onviewsecret={handleClientViewSecret}
	onedit={handleClientEdit}
	onregenerate={handleClientRegenerate}
	onrevoke={handleClientRevoke}
	ondelete={handleClientDelete}
/>

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

<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';

	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Table from '$lib/components/ui/table';

	import {
		formatOpenMemberName,
		isOnlineRequiredError,
		useUnassignedRegistrationSearch,
		UnassignedRegistrationApiError,
		type UnassignedRegistrationSearchHit
	} from '$lib/features/unassigned-registration';

	let searchQuery = $state('');
	let submittedQuery = $state('');
	let selected = $state<UnassignedRegistrationSearchHit | null>(null);
	let sheetOpen = $state(false);

	const search = useUnassignedRegistrationSearch(() => submittedQuery);

	const results = $derived(search.data?.results ?? []);
	const isPending = $derived(search.isPending && submittedQuery.length > 0);
	const isError = $derived(search.isError);
	const onlineRequired = $derived(
		isError &&
			(isOnlineRequiredError(search.error) ||
				(search.error instanceof UnassignedRegistrationApiError &&
					search.error.code === 'ONLINE_REQUIRED'))
	);

	function runSearch() {
		submittedQuery = searchQuery.trim();
		selected = null;
		sheetOpen = false;
	}

	function openDocument(hit: UnassignedRegistrationSearchHit) {
		selected = hit;
		sheetOpen = true;
	}

	function clearSearch() {
		searchQuery = '';
		submittedQuery = '';
		selected = null;
		sheetOpen = false;
	}
</script>

<div class="flex flex-col gap-4">
	<div class="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm text-slate-700">
		ค้นหาคิว <span class="font-semibold">ลงทะเบียนล่วงหน้าไม่ระบุศูนย์</span> จากส่วนกลาง (Mongo) —
		เฉพาะสมาชิกที่ยัง <span class="font-semibold">open</span> · ต้องออนไลน์
	</div>

	<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
		<div class="relative flex-1">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				placeholder="ชื่อ เบอร์โทร หรือเลขบัตร ของสมาชิกที่ยัง open..."
				bind:value={searchQuery}
				class="h-10 pl-9"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						runSearch();
					}
				}}
			/>
			{#if searchQuery}
				<button
					type="button"
					class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
					onclick={clearSearch}
				>
					<X class="size-3.5" />
				</button>
			{/if}
		</div>
		<Button type="button" onclick={runSearch} class="gap-2">
			<Search class="size-4" />
			ค้นหาคิวกลาง
		</Button>
	</div>

	{#if !submittedQuery}
		<p class="text-sm text-muted-foreground">พิมพ์คำค้นแล้วกดค้นหาเพื่อดึงรายการจากคิวกลาง</p>
	{:else if isPending}
		<div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
			กำลังค้นหา...
		</div>
	{:else if isError}
		<div
			class="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-950"
		>
			<p>
				{#if onlineRequired}
					ต้องเชื่อมต่อส่วนกลางเพื่อค้นหาคิวลงทะเบียนล่วงหน้า (ไม่ระบุศูนย์)
				{:else}
					ค้นหาไม่สำเร็จ — ตรวจสอบการเชื่อมต่อส่วนกลางแล้วลองใหม่
				{/if}
			</p>
			<Button type="button" variant="outline" onclick={runSearch}>ลองอีกครั้ง</Button>
		</div>
	{:else if results.length === 0}
		<div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
			ไม่พบสมาชิก open ที่ตรงกับคำค้น
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-muted/30">
							<Table.Head class="pl-4">สมาชิก open</Table.Head>
							<Table.Head>เบอร์โทร</Table.Head>
							<Table.Head>เลขบัตร</Table.Head>
							<Table.Head>สร้างเมื่อ</Table.Head>
							<Table.Head class="pr-4">เอกสารคิว</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each results as hit (hit.id)}
							{#each hit.open_members as member (member.reserved_evacuee_id)}
								<Table.Row class="cursor-pointer" onclick={() => openDocument(hit)}>
									<Table.Cell class="pl-4 font-medium">{formatOpenMemberName(member)}</Table.Cell>
									<Table.Cell class="text-sm tabular-nums">{member.phone ?? '—'}</Table.Cell>
									<Table.Cell class="text-sm tabular-nums"
										>{member.person_id?.number ?? '—'}</Table.Cell
									>
									<Table.Cell class="text-xs text-muted-foreground"
										>{hit.created_at.slice(0, 16).replace('T', ' ')}</Table.Cell
									>
									<Table.Cell class="pr-4">
										<Badge variant="outline" class="font-normal">เปิดเอกสาร</Badge>
									</Table.Cell>
								</Table.Row>
							{/each}
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	{/if}
</div>

<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content side="right" class="flex w-full flex-col gap-4 sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>คิวลงทะเบียนล่วงหน้า (ไม่ระบุศูนย์)</Sheet.Title>
			<Sheet.Description>
				เอกสารคิวกลาง — สมาชิก open ด้านล่างพร้อมรับเข้าศูนย์ (claim) ในขั้นตอนถัดไป
			</Sheet.Description>
		</Sheet.Header>
		{#if selected}
			<div class="space-y-3 text-sm">
				<div class="rounded-xl border border-slate-200/80 bg-white p-3">
					<p class="text-xs font-semibold text-slate-500">รหัสเอกสาร</p>
					<p class="break-all text-slate-900 tabular-nums">{selected.id}</p>
					<p class="mt-2 text-xs font-semibold text-slate-500">ครัวเรือนสำรอง</p>
					<p class="break-all text-slate-900 tabular-nums">{selected.reserved_household_id}</p>
				</div>
				<div>
					<p class="mb-2 text-sm font-semibold text-slate-900">สมาชิกที่ยัง open</p>
					<ul class="space-y-2">
						{#each selected.open_members as member (member.reserved_evacuee_id)}
							<li class="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
								<p class="font-medium text-slate-900">{formatOpenMemberName(member)}</p>
								<p class="text-xs text-muted-foreground tabular-nums">
									{member.phone ?? 'ไม่มีเบอร์'} · {member.person_id?.number ?? 'ไม่มีเลขบัตร'}
								</p>
								<p class="mt-1 text-xs text-slate-500">{member.reserved_evacuee_id}</p>
							</li>
						{/each}
					</ul>
				</div>
				<p class="text-xs text-muted-foreground">
					ขั้นตอนถัดไป: รับสมาชิก open เข้าศูนย์นี้ (claim) จะสร้าง Evacuee ใน Couch ที่สถานะ
					ลงทะเบียนล่วงหน้า
				</p>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<script lang="ts">
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Search from '@lucide/svelte/icons/search';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Info from '@lucide/svelte/icons/info';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import {
		donationActionRef,
		donationRefLabel,
		type PendingDonationRow
	} from '$lib/features/donations';

	let {
		requests = [],
		loading = false,
		onViewDetails
	}: {
		requests: PendingDonationRow[];
		loading?: boolean;
		onViewDetails: (request: PendingDonationRow) => void;
	} = $props();

	let searchQuery = $state('');
	let sourceFilter = $state('all');
	let sortOrder = $state<'newest' | 'oldest'>('newest');

	function itemsSummary(req: PendingDonationRow): string {
		if (req.items.length === 0) return '—';
		return req.items
			.map((it) => `${it.free_text ?? it.item_id ?? 'ไม่ระบุ'} ${it.qty} ${it.unit}`)
			.join(', ');
	}

	/**
	 * How long the request has been waiting. Returns an em dash rather than a made-up
	 * duration when the doc carries no `declared_at` — staff prioritise this queue by
	 * age, so a placeholder time would be read as fact.
	 */
	function formatRelativeTime(dateStr?: string | null): string {
		if (!dateStr) return '—';
		const parsed = Date.parse(dateStr);
		if (Number.isNaN(parsed)) return '—';
		const diffMins = Math.floor((Date.now() - parsed) / 60000);
		if (diffMins < 1) return 'ส่งเมื่อสักครู่';
		if (diffMins < 60) return `ส่งเมื่อ ${diffMins} นาทีที่แล้ว`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `ส่งเมื่อ ${diffHours} ชั่วโมงที่แล้ว`;
		return `ส่งเมื่อ ${Math.floor(diffHours / 24)} วันที่แล้ว`;
	}

	/**
	 * Why this booking needs a human before it can be received.
	 *
	 * Since CR-052 §1.4 EVERY public booking opens in `pending_review`, so "it is in
	 * this queue" is not by itself an unsolicited-goods flag — the two branches used to
	 * return the same sentence, labelling every request as unsolicited.
	 */
	function getTriggerReason(req: PendingDonationRow): string {
		if (req.is_unsolicited) {
			return 'สิ่งของนอกเหนือรายการแจ้งความต้องการ (Unsolicited Donation)';
		}
		return 'รายการตามประกาศ — รอเจ้าหน้าที่ยืนยันก่อนเข้าขั้นตรวจรับ (CR-052)';
	}

	const filteredRequests = $derived.by(() => {
		let list = [...requests];

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			list = list.filter((r) => {
				const nameMatch = r.donor_name?.toLowerCase().includes(q);
				const refMatch = r.booking_ref?.toLowerCase().includes(q);
				const itemMatch = r.items?.some(
					(it) => it.free_text?.toLowerCase().includes(q) || it.item_id?.toLowerCase().includes(q)
				);
				return nameMatch || refMatch || itemMatch;
			});
		}

		if (sourceFilter === 'unsolicited') {
			list = list.filter((r) => r.is_unsolicited);
		} else if (sourceFilter === 'solicited') {
			list = list.filter((r) => !r.is_unsolicited);
		}

		list.sort((a, b) => {
			const dateA = a.declared_at ?? '';
			const dateB = b.declared_at ?? '';
			return sortOrder === 'newest' ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
		});

		return list;
	});
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<!-- Section Header -->
	<div
		class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 md:flex-row md:items-center"
	>
		<div>
			<h2 class="flex items-center gap-2.5 text-base font-bold text-foreground">
				<div
					class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
				>
					<ClipboardCheck class="h-5 w-5" />
				</div>
				รายการรอตรวจสอบความเหมาะสม (Pending Review Board)
			</h2>
			<p class="mt-1 text-2xs text-muted-foreground">
				ระบบกรองอนุมัติคำขอขอบริจาคพิเศษที่มีน้ำหนักหรือคุณสมบัติจำเป็นต้องให้ส่วนกลางประเมินพื้นที่คลังและการกระจายพัสดุก่อนรับเข้าจริง
			</p>
		</div>
	</div>

	<!-- Filter Bar -->
	<div class="border-b border-border/60 bg-card p-4">
		<div class="flex flex-col gap-3 md:flex-row md:items-center">
			<!-- Search input -->
			<div class="relative flex-1">
				<Search
					class="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="text"
					placeholder="ค้นหาชื่อผู้บริจาค, รหัสคำขอ, หรือรายการสิ่งของ..."
					bind:value={searchQuery}
					class="h-9 rounded-xl pl-9 text-xs"
				/>
			</div>

			<!-- Filter dropdowns -->
			<div class="flex flex-wrap items-center gap-2">
				<select
					bind:value={sourceFilter}
					class="h-9 rounded-xl border border-border/80 bg-background px-3 text-xs text-foreground focus:ring-2 focus:ring-primary/20 focus:outline-none"
				>
					<option value="all">ที่มา: ทั้งหมด</option>
					<option value="unsolicited">ที่มา: รายการไม่อยู่ในประกาศ</option>
					<option value="solicited">ที่มา: รายการตามประกาศ</option>
				</select>

				<select
					bind:value={sortOrder}
					class="h-9 rounded-xl border border-border/80 bg-background px-3 text-xs text-foreground focus:ring-2 focus:ring-primary/20 focus:outline-none"
				>
					<option value="newest">เรียง: ใหม่สุดก่อน</option>
					<option value="oldest">เรียง: เก่าสุดก่อน</option>
				</select>
			</div>
		</div>
	</div>

	<!-- Requests Table -->
	<div class="overflow-x-auto">
		<Table.Root class="w-full border-collapse text-left">
			<Table.Header>
				<Table.Row
					class="border-b border-border bg-muted/15 text-xs font-bold text-muted-foreground"
				>
					<Table.Head class="px-6 py-4 text-xs font-bold text-foreground/80"
						>ผู้ส่งและรหัสคำขอ (DONOR INFO)</Table.Head
					>
					<Table.Head class="px-6 py-4 text-xs font-bold text-foreground/80"
						>รายการที่เสนอ (ITEMS PROPOSED)</Table.Head
					>
					<Table.Head class="px-6 py-4 text-xs font-bold text-foreground/80"
						>ประเด็นการตรวจสอบ (TRIGGER REASON)</Table.Head
					>
					<Table.Head class="px-6 py-4 text-right text-xs font-bold text-foreground/80"
						>การจัดการคำขอ (ACTION)</Table.Head
					>
				</Table.Row>
			</Table.Header>
			<Table.Body class="divide-y divide-border/60 text-xs">
				{#if loading}
					<Table.Row>
						<Table.Cell colspan={4} class="px-6 py-12 text-center text-muted-foreground">
							กำลังโหลดข้อมูล...
						</Table.Cell>
					</Table.Row>
				{:else if filteredRequests.length === 0}
					<Table.Row>
						<Table.Cell colspan={4} class="px-6 py-12 text-center text-muted-foreground">
							ไม่มีรายการที่อยู่ระหว่างการรอการประเมิน
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each filteredRequests as req (donationActionRef(req) ?? req.declared_at)}
						<Table.Row class="transition-colors hover:bg-muted/10">
							<!-- Donor Info & Ref -->
							<Table.Cell class="min-w-[240px] px-6 py-4">
								<div class="text-sm font-bold text-foreground">
									{req.donor_name || 'ไม่ระบุชื่อ'}
								</div>
								<div class="mt-1.5 flex flex-wrap items-center gap-2 text-2xs">
									<span
										class="rounded-md bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
									>
										รอพิจารณาอนุมัติ
									</span>
									<span class="font-semibold text-muted-foreground">
										{donationRefLabel(req)}
									</span>
									<span class="text-muted-foreground">·</span>
									<span class="text-muted-foreground">
										{formatRelativeTime(req.declared_at)}
									</span>
								</div>
							</Table.Cell>

							<!-- Items Proposed -->
							<Table.Cell class="min-w-[260px] px-6 py-4 text-xs font-medium text-foreground">
								{itemsSummary(req)}
							</Table.Cell>

							<!-- Trigger Reason -->
							<Table.Cell class="min-w-[300px] px-6 py-4">
								<div
									class="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300"
								>
									<Info class="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
									<span>{getTriggerReason(req)}</span>
								</div>
							</Table.Cell>

							<!-- Action Button -->
							<Table.Cell class="px-6 py-4 text-right">
								<button
									type="button"
									onclick={() => onViewDetails(req)}
									class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50/80 px-3.5 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
								>
									<SlidersHorizontal class="h-3.5 w-3.5" />
									จัดการ
								</button>
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>

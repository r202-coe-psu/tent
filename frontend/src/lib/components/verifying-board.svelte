<script lang="ts">
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import {
		donationActionRef,
		donationRefLabel,
		type PendingDonationRow
	} from '$lib/features/donations';

	let {
		requests = [],
		loading = false,
		onVerify
	}: {
		requests: PendingDonationRow[];
		loading?: boolean;
		onVerify: (bookingRef: string) => void;
	} = $props();

	function itemsSummary(req: PendingDonationRow): string {
		if (req.items.length === 0) return '—';
		return req.items
			.map((it) => `${it.free_text ?? it.item_id ?? 'ไม่ระบุ'} ${it.qty} ${it.unit}`)
			.join(', ');
	}
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<div
		class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 md:flex-row md:items-center"
	>
		<div>
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<PackageCheck class="h-5 w-5 text-primary" />
				กำลังตรวจรับ (Verifying Drop-off)
			</h2>
			<p class="mt-1 text-2xs text-muted-foreground">
				รายการที่ผ่านการอนุมัติแล้ว รอเจ้าหน้าที่ตรวจนับจำนวนจริงและกระทบยอดเข้าคลัง
			</p>
		</div>
	</div>
	<div class="divide-y divide-border/60">
		{#if loading}
			<p class="px-6 py-12 text-center text-xs text-muted-foreground">กำลังโหลดข้อมูล...</p>
		{:else}
			{#each requests as req (donationActionRef(req) ?? req.declared_at)}
				<div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-sm font-bold text-foreground"
								>{req.donor_name || 'ไม่ระบุชื่อ'}</span
							>
							<span
								class="rounded border border-border bg-muted/50 px-2 py-0.5 text-2xs font-medium text-muted-foreground"
							>
								{donationRefLabel(req)}
							</span>
						</div>
						<p class="mt-1 text-2xs text-muted-foreground">{itemsSummary(req)}</p>
					</div>
					<button
						onclick={() => {
							const ref = donationActionRef(req);
							if (ref) onVerify(ref);
						}}
						class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
					>
						<ClipboardCheck class="h-3.5 w-3.5" />
						ตรวจรับ
					</button>
				</div>
			{:else}
				<p class="px-6 py-12 text-center text-xs text-muted-foreground">
					ไม่มีรายการที่อยู่ระหว่างการตรวจรับ
				</p>
			{/each}
		{/if}
	</div>
</div>

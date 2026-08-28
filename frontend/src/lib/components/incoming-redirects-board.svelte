<script lang="ts">
	import Inbox from '@lucide/svelte/icons/inbox';
	import Phone from '@lucide/svelte/icons/phone';
	import type { DonationRedirect } from '$lib/features/donations';

	/**
	 * Requests other shelters handed to this one (R-16.4 · CR-087). Read-only for
	 * now: a `donation_redirect` is the destination's own record and does not carry
	 * the origin's review state, so acting on one is a separate step CR-087 leaves
	 * to a follow-up.
	 */
	let {
		redirects = [],
		loading = false
	}: {
		redirects: DonationRedirect[];
		loading?: boolean;
	} = $props();

	function itemsSummary(r: DonationRedirect): string {
		if (r.items.length === 0) return '—';
		return r.items
			.map((it) => `${it.free_text ?? it.item_id ?? 'ไม่ระบุ'} ${it.qty} ${it.unit}`)
			.join(', ');
	}
</script>

<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
	<div class="border-b border-border/60 bg-muted/5 p-6">
		<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
			<Inbox class="h-5 w-5 text-primary" />
			คำขอที่ถูกส่งต่อมา (Incoming Redirects)
		</h2>
		<p class="mt-1 text-2xs text-muted-foreground">
			รายการบริจาคที่ศูนย์อื่นรับไม่ได้และส่งต่อมาให้ศูนย์นี้พิจารณา — ยังไม่ได้ลงบัญชีคลังที่ใด
		</p>
	</div>
	<div class="divide-y divide-border/60">
		{#if loading}
			<p class="px-6 py-12 text-center text-xs text-muted-foreground">กำลังโหลดข้อมูล...</p>
		{:else}
			{#each redirects as r (r._id)}
				<div class="flex flex-col gap-2 p-4">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-bold text-foreground">{r.donor.name || 'ไม่ระบุชื่อ'}</span>
						{#if r.booking_ref}
							<span
								class="rounded border border-border bg-muted/50 px-2 py-0.5 text-2xs font-medium text-muted-foreground"
							>
								{r.booking_ref}
							</span>
						{/if}
						<span
							class="rounded bg-blue-100 px-2 py-0.5 text-2xs font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"
						>
							ส่งต่อจาก {r.origin_shelter_code}
						</span>
					</div>
					<p class="text-2xs text-muted-foreground">{itemsSummary(r)}</p>
					{#if r.donor.phone}
						<p class="flex items-center gap-1.5 text-2xs text-muted-foreground">
							<Phone class="h-3 w-3" />
							{r.donor.phone}
						</p>
					{/if}
					{#if r.note}
						<p class="rounded-lg bg-muted/40 p-2 text-2xs text-foreground">
							หมายเหตุจากศูนย์ต้นทาง: {r.note}
						</p>
					{/if}
				</div>
			{:else}
				<p class="px-6 py-12 text-center text-xs text-muted-foreground">
					ยังไม่มีคำขอที่ถูกส่งต่อมา
				</p>
			{/each}
		{/if}
	</div>
</div>

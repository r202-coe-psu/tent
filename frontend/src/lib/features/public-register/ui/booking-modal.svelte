<script lang="ts">
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { listPublicShelters, toPublicShelterCard } from '$lib/features/public-portal';
	import type { PublicShelterCardModel } from '$lib/features/public-portal';
	import BookingForm from './booking-form.svelte';
	import BookingTicketView from './booking-ticket.svelte';
	import type { BookingTicket } from '../application/booking-store.svelte';

	interface Props {
		open?: boolean;
		/** Preselect and lock a shelter — used by the CTA on a shelter detail page. */
		shelterCode?: string;
	}

	let { open = $bindable(false), shelterCode = '' }: Props = $props();

	let shelters = $state<PublicShelterCardModel[]>([]);
	let vulnerableGroups = $state<{ code: string; label: string }[]>([]);
	let loadError = $state('');
	let loaded = $state(false);
	let ticket = $state<BookingTicket | null>(null);

	/**
	 * Load reference data the first time the dialog opens, not on page load — the
	 * booking modal is mounted on every public page, and most visitors never open
	 * it. Reference data only, so one fetch per session is enough.
	 */
	$effect(() => {
		if (!open || loaded) return;
		loaded = true;
		void (async () => {
			try {
				const [shelterRes, groupRes] = await Promise.all([
					listPublicShelters({}),
					fetch('/api/public/v1/config/vulnerable-groups').then((r) =>
						r.ok ? r.json() : { groups: [] }
					)
				]);
				shelters = (shelterRes?.shelters ?? []).map((s) => toPublicShelterCard(s as never));
				vulnerableGroups = groupRes?.groups ?? [];
			} catch {
				loadError = 'โหลดรายชื่อศูนย์พักพิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
				loaded = false;
			}
		})();
	});

	function reset() {
		ticket = null;
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) reset();
	}}
>
	<Dialog.Content class="max-h-[90svh] gap-0 overflow-y-auto sm:max-w-3xl">
		<Dialog.Header class="pb-4">
			<Dialog.Title class="flex items-center gap-2 text-lg">
				<ClipboardCheck class="h-5 w-5 text-primary" />
				{ticket ? 'ใบจองเข้าศูนย์พักพิง' : 'จองเข้าศูนย์พักพิงล่วงหน้า'}
			</Dialog.Title>
			<Dialog.Description>
				{ticket
					? 'กรุณาบันทึกหรือพิมพ์ใบจองนี้ไว้แสดงที่ประตูศูนย์'
					: 'กันที่ไว้ก่อนเดินทาง ลดเวลารอที่หน้าประตู และช่วยให้ศูนย์เตรียมอาหารและเครื่องนอนได้ตรงจำนวน'}
			</Dialog.Description>
		</Dialog.Header>

		{#if ticket}
			<BookingTicketView {ticket} />
		{:else if loadError}
			<p class="rounded-xl border border-danger/30 bg-danger-muted/40 p-4 text-sm text-danger">
				{loadError}
			</p>
		{:else if shelters.length === 0}
			<p class="p-8 text-center text-sm text-muted-foreground">กำลังโหลดรายชื่อศูนย์พักพิง…</p>
		{:else}
			<BookingForm
				{shelters}
				{vulnerableGroups}
				lockedShelterCode={shelterCode}
				onbooked={(t) => (ticket = t)}
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>

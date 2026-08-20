<script lang="ts">
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import { env } from '$env/dynamic/public';
	import { PublicHeroMetrics, PublicPageShell } from '$lib/features/public-portal';
	import {
		BookingPersonStep,
		BookingShelterStep,
		BookingStepper,
		BookingTicket,
		setBookingStore
	} from '$lib/features/public-register';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	const booking = setBookingStore();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';

	// Deep link from a shelter detail page (`?shelter=CODE`) — lock step 1 and open
	// the form. An $effect rather than init-time code so a client-side navigation
	// to a different `?shelter=` re-applies; `appliedCode` keeps it from dragging
	// the citizen back to step 2 after they press ย้อนกลับ.
	let appliedCode = '';
	$effect(() => {
		const code = data.preselected;
		if (!code || appliedCode === code) return;
		const shelter = data.shelters.find((s) => s.code === code);
		if (!shelter) return;
		appliedCode = code;
		booking.selectShelter(shelter);
		booking.shelterLocked = true;
		booking.goTo('person', 2);
	});
</script>

<svelte:head>
	<title>จองเข้าศูนย์ล่วงหน้า — Smart Shelter</title>
	<meta
		name="description"
		content="จองที่พักในศูนย์พักพิงล่วงหน้าผ่านเว็บ รับ QR สำหรับยืนยันตัวตนที่ประตูศูนย์"
	/>
	{#if siteKey}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

<PublicPageShell class="space-y-6">
	{#if booking.activeStep === 'shelter'}
		<PublicHeroMetrics
			title="จองเข้าศูนย์พักพิงล่วงหน้า"
			description="กันที่ไว้ก่อนเดินทาง ลดเวลารอที่หน้าประตู และช่วยให้ศูนย์เตรียมอาหารและเครื่องนอนได้ตรงจำนวน"
			badgeText="Shelter Booking"
			badgeIcon={ClipboardCheck}
			showLivePing={false}
			showSearch={false}
			bgClass="bg-primary-dark"
		/>
	{/if}

	<BookingStepper />

	<div class="w-full transition-all duration-500">
		{#if booking.activeStep === 'shelter'}
			<BookingShelterStep shelters={data.shelters} />
		{:else if booking.activeStep === 'person'}
			<BookingPersonStep />
		{:else if booking.ticket}
			<BookingTicket ticket={booking.ticket} />
		{/if}
	</div>
</PublicPageShell>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		lookupErrorCode: string | null;
		isPhoneGate: boolean;
		isLookingUp: boolean;
		retryAfterSeconds: number;
		homeUrl: string;
		backUrl: string;
		onretry: () => void;
		onreset: () => void;
	}

	let {
		lookupErrorCode,
		isPhoneGate,
		isLookingUp,
		retryAfterSeconds,
		homeUrl,
		backUrl,
		onretry,
		onreset
	}: Props = $props();

	const isMethodDisabled = $derived(lookupErrorCode === 'KIOSK_METHOD_DISABLED');
	const isPhoneLookupMiss = $derived(
		isPhoneGate &&
			(lookupErrorCode === 'PRE_REGISTRATION_NOT_FOUND' ||
				lookupErrorCode === 'KIOSK_TOO_MANY_MATCHES')
	);
</script>

<div class="mt-4 flex flex-col gap-2 sm:flex-row">
	{#if isMethodDisabled}
		<!-- FR-KPT-24: method was switched off mid-session — no retry, only go home -->
	{:else if isPhoneLookupMiss}
		<Button
			type="button"
			onclick={onreset}
			class="min-h-12 bg-[#0A2647] px-5 text-base font-bold text-white hover:bg-[#051930]"
			>กรอกเบอร์ใหม่</Button
		>
	{:else}
		<Button
			type="button"
			disabled={isLookingUp || retryAfterSeconds > 0}
			onclick={onretry}
			class="min-h-12 bg-[#0A2647] px-5 text-base font-bold text-white hover:bg-[#051930]"
		>
			{#if retryAfterSeconds > 0}
				ลองอีกครั้งใน {retryAfterSeconds} วินาที
			{:else if isLookingUp}
				กำลังค้นหา…
			{:else}
				ลองอีกครั้ง
			{/if}
		</Button>
	{/if}
	<Button
		href={isMethodDisabled ? homeUrl : backUrl}
		variant="outline"
		onclick={onreset}
		class="min-h-12 border-[#CBD5E1] px-5 text-base font-bold text-[#0A2647]">กลับ</Button
	>
</div>

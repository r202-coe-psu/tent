<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';

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

<!-- Rendered in a KioskNoticePanel's actions: the panel stacks and sizes them. -->
{#if !isMethodDisabled}
	{#if isPhoneLookupMiss}
		<Button type="button" onclick={onreset} class={KIOSK_NOTICE_PRIMARY_ACTION}
			>กรอกเบอร์ใหม่</Button
		>
	{:else}
		<Button
			type="button"
			disabled={isLookingUp || retryAfterSeconds > 0}
			onclick={onretry}
			class={KIOSK_NOTICE_PRIMARY_ACTION}
		>
			{#if retryAfterSeconds > 0}
				ลองอีกครั้งใน <span class="tabular-nums">{retryAfterSeconds}</span> วินาที
			{:else if isLookingUp}
				กำลังค้นหา…
			{:else}
				ลองอีกครั้ง
			{/if}
		</Button>
	{/if}
{/if}
<!-- The only way on when the method is off: then it is the main button. -->
<Button
	href={isMethodDisabled ? homeUrl : backUrl}
	variant={isMethodDisabled ? 'default' : 'outline'}
	onclick={onreset}
	class={isMethodDisabled ? KIOSK_NOTICE_PRIMARY_ACTION : KIOSK_NOTICE_SECONDARY_ACTION}
	>กลับ</Button
>

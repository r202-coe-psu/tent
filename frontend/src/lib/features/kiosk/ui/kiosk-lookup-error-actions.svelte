<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';

	interface Props {
		lookupErrorCode: string | null;
		isPhoneGate: boolean;
		isThaidGate?: boolean;
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
		isThaidGate = false,
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
	/** The verified ThaiD session was used up, expired or mismatched: only a new QR scan can go on. */
	const isThaidSessionInvalid = $derived(lookupErrorCode === 'KIOSK_THAID_SESSION_INVALID');
	/** Retrying cannot find a pre-registration that is not there, and ThaiD never offers walk-in. */
	const isThaidLookupMiss = $derived(
		isThaidGate && lookupErrorCode === 'PRE_REGISTRATION_NOT_FOUND'
	);
	const backIsPrimary = $derived(isMethodDisabled || isThaidLookupMiss);
</script>

<!-- Rendered in a KioskNoticePanel's actions: the panel stacks and sizes them. -->
{#if !backIsPrimary}
	{#if isThaidSessionInvalid}
		<Button type="button" onclick={onreset} class={KIOSK_NOTICE_PRIMARY_ACTION}>สแกนใหม่</Button>
	{:else if isPhoneLookupMiss}
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
<!-- The only way on when the method is off (or nothing was found): then it is the main button. -->
<Button
	href={backIsPrimary ? homeUrl : backUrl}
	variant={backIsPrimary ? 'default' : 'outline'}
	onclick={isThaidGate ? undefined : onreset}
	class={backIsPrimary ? KIOSK_NOTICE_PRIMARY_ACTION : KIOSK_NOTICE_SECONDARY_ACTION}>กลับ</Button
>

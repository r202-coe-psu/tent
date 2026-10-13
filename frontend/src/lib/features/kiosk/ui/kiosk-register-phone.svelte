<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import PhoneOff from '@lucide/svelte/icons/phone-off';
	import { Button } from '$lib/components/ui/button/index.js';
	import KioskNumpadPanel from './kiosk-numpad-panel.svelte';
	import {
		formatPhoneForDisplay,
		isKioskPhoneSubmittable,
		normalizeKioskPhone,
		phoneEntryHint
	} from '../domain/phone';

	interface Props {
		/** Saving: keys and buttons wait. */
		disabled?: boolean;
		/** The canonical phone, or `null` when the visitor has none. */
		onconfirm: (phone: string | null) => void;
	}

	let { disabled = false, onconfirm }: Props = $props();
	let phone = $state('');
	const isValid = $derived(isKioskPhoneSubmittable(phone));
	const entryHint = $derived(phoneEntryHint(phone));
	const displayPhone = $derived(formatPhoneForDisplay(phone));

	function confirm(): void {
		if (disabled || !isValid) return;
		onconfirm(normalizeKioskPhone(phone));
	}

	function skip(): void {
		if (disabled) return;
		onconfirm(null);
	}
</script>

<!--
	Walk-in phone step: asked last, once who they are is settled. Optional — not everyone in a
	shelter has a phone, and the kiosk must never get stuck here.
-->
<KioskNumpadPanel
	bind:value={phone}
	maxLength={10}
	{disabled}
	onsubmit={confirm}
	labelledby="kiosk-register-phone-title"
	testid="kiosk-register-phone"
>
	{#snippet header()}
		<header class="text-center">
			<h1
				id="kiosk-register-phone-title"
				class="text-2xl font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-4xl"
			>
				เบอร์โทรศัพท์ที่ติดต่อได้
			</h1>
			<p class="mt-1 text-base text-slate-700 kiosk-portrait:text-xl">
				เจ้าหน้าที่จะใช้ติดต่อคุณ ถ้าไม่มีเบอร์ กด「ไม่มีเบอร์」ได้เลย
			</p>
		</header>
	{/snippet}

	{#snippet display()}
		<output
			class={[
				'flex min-h-14 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-2xl font-bold text-slate-950 tabular-nums kiosk-portrait:min-h-20 kiosk-portrait:rounded-2xl kiosk-portrait:border-2',
				displayPhone
					? 'kiosk-portrait:text-4xl'
					: 'kiosk-portrait:text-2xl kiosk-portrait:font-semibold kiosk-portrait:text-slate-400'
			]}
			aria-label="เบอร์โทรศัพท์ที่กรอก"
			aria-live="polite"
		>
			{displayPhone || 'เบอร์โทรศัพท์'}
		</output>
	{/snippet}

	{#snippet actions()}
		<Button
			type="button"
			disabled={disabled || !isValid}
			onclick={confirm}
			class="min-h-12 w-full gap-2 bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
		>
			<Check class="h-5 w-5" aria-hidden="true" />ยืนยันเบอร์นี้
		</Button>
		<Button
			type="button"
			variant="outline"
			{disabled}
			onclick={skip}
			class="min-h-12 w-full gap-2 text-base font-semibold kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
		>
			<PhoneOff class="h-5 w-5" aria-hidden="true" />ไม่มีเบอร์
		</Button>
	{/snippet}

	{#snippet footer()}
		<p
			class="min-h-7 text-center text-sm font-semibold text-amber-900 kiosk-portrait:text-lg"
			aria-live="polite"
		>
			{entryHint ?? ''}
		</p>
	{/snippet}
</KioskNumpadPanel>

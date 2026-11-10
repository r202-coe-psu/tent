<script lang="ts">
	import type { FrontlineRecipientSelection } from '../../model/frontline-handover';

	let { value = $bindable(null) }: { value?: FrontlineRecipientSelection | null } = $props();

	const base = {
		recipientType: 'evacuee' as const,
		recipientId: 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0',
		householdId: 'household:test-1',
		label: 'สุนิตา บางค้างพลู'
	};
	const qrOverride = {
		issued_at: '2026-11-08T06:52:00.000Z',
		current_printed_at: '2026-11-08T06:53:00.000Z',
		overridden_at: '2026-11-08T07:00:00.000Z'
	};

	// `bind:this` hosts call these on the picker.
	export function next() {}
	export function scan() {}
</script>

<span data-testid="picked" hidden>{value?.recipientId ?? ''}</span>
<button type="button" data-testid="pick-evacuee" onclick={() => (value = { ...base })}>
	pick evacuee
</button>
<button
	type="button"
	data-testid="pick-evacuee-qr-override"
	onclick={() => (value = { ...base, qrOverride })}
>
	pick evacuee with expired QR
</button>
<button
	type="button"
	data-testid="pick-outside"
	onclick={() =>
		(value = { recipientType: 'outside', recipientId: null, label: 'บุคคลภายนอก (ไม่ระบุตัวตน)' })}
>
	pick outside
</button>

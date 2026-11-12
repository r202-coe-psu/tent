<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { InternalBannerDisplay, InternalBannerKeypad } from '$lib/features/kiosk';

	const INVALID_CODE_MESSAGE = 'รหัสไม่ถูกต้องหรือถูกเปลี่ยนแล้ว';

	const shelter = $derived(page.params.shelter ?? '');
	const rawCode = $derived(page.url.searchParams.get('c'));
	const code = $derived(rawCode !== null && /^\d{6}$/.test(rawCode) ? rawCode : null);
	const wasInvalid = $derived(page.url.searchParams.get('invalid') === '1');

	// `resolve` types only the route id; the query rides on it (same pattern as item-master-tab).
	function openCode(next: string) {
		void goto(
			resolve(`/banner/[shelter]/internal?c=${next}` as '/banner/[shelter]/internal', { shelter })
		);
	}

	function backToKeypad() {
		void goto(
			resolve(`/banner/[shelter]/internal?invalid=1` as '/banner/[shelter]/internal', { shelter }),
			{ replaceState: true }
		);
	}
</script>

<svelte:head>
	<title>ประกาศภายในศูนย์</title>
</svelte:head>

{#if code}
	{#key `${shelter}:${code}`}
		<InternalBannerDisplay {shelter} {code} oninvalid={backToKeypad} />
	{/key}
{:else}
	<InternalBannerKeypad error={wasInvalid ? INVALID_CODE_MESSAGE : null} onsubmit={openCode} />
{/if}

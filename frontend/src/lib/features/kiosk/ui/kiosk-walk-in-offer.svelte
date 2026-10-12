<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';
	import KioskNoticePanel from './kiosk-notice-panel.svelte';

	interface Props {
		isLookingUp: boolean;
		retryAfterSeconds: number;
		onregister: () => void;
		onretry: () => void;
	}

	let { isLookingUp, retryAfterSeconds, onregister, onretry }: Props = $props();
</script>

<!--
	A card with no pre-registration is not an error: this is the way in for people who walked in.
	Registering here is the one obvious next step; searching again stays available but quiet.
-->
<KioskNoticePanel
	tone="info"
	icon={UserPlus}
	title="ลงทะเบียนที่ตู้นี้ได้เลย"
	data-testid="kiosk-walk-in-offer"
>
	<p>
		ระบบจะใช้ข้อมูลจากบัตรประชาชนที่เสียบอยู่ เมื่อเสร็จแล้วกรุณาไปพบเจ้าหน้าที่เพื่อยืนยันข้อมูล
	</p>
	{#snippet actions()}
		<Button type="button" onclick={onregister} class={KIOSK_NOTICE_PRIMARY_ACTION}>
			<UserPlus aria-hidden="true" />ลงทะเบียนที่ตู้นี้<ChevronRight aria-hidden="true" />
		</Button>
		<Button
			type="button"
			variant="outline"
			disabled={isLookingUp || retryAfterSeconds > 0}
			onclick={onretry}
			class={KIOSK_NOTICE_SECONDARY_ACTION}
		>
			{#if retryAfterSeconds > 0}
				ค้นหาอีกครั้งได้ใน <span class="tabular-nums">{retryAfterSeconds}</span> วินาที
			{:else if isLookingUp}
				กำลังค้นหา…
			{:else}
				ลงทะเบียนล่วงหน้าไว้แล้ว? ค้นหาอีกครั้ง
			{/if}
		</Button>
	{/snippet}
</KioskNoticePanel>

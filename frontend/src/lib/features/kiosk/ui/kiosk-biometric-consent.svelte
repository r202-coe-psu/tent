<script lang="ts">
	import ScanFace from '@lucide/svelte/icons/scan-face';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';

	interface Props {
		onagree: () => void;
		ondecline: () => void;
		/** h2 when the page already has its own h1. */
		headingTag?: 'h1' | 'h2';
	}

	let { onagree, ondecline, headingTag = 'h1' }: Props = $props();
</script>

<!--
	Consent for the face check, asked on its own: it is separate from consent to read the card, and
	saying no must stay a real choice (staff check the person instead; service is never withheld).
	Wording is a draft for the data-protection review.
-->
<div aria-labelledby="face-consent-title">
	<!-- Under another heading on a short screen the page title already says this: save the row. -->
	<div
		class={[
			'mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-900 kiosk-compact:mb-2',
			headingTag === 'h2' && 'kiosk-compact:hidden'
		]}
	>
		<ScanFace class="size-4" aria-hidden="true" />ตรวจสอบตัวตน
	</div>
	<svelte:element
		this={headingTag}
		id="face-consent-title"
		class="text-2xl font-bold text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl kiosk-compact:text-2xl"
	>
		ตรวจใบหน้าเทียบกับรูปในบัตร
	</svelte:element>
	<div
		class="mt-4 space-y-3 text-lg leading-relaxed text-slate-700 kiosk-portrait:text-2xl kiosk-compact:mt-1.5 kiosk-compact:space-y-1 kiosk-compact:text-base kiosk-compact:leading-snug"
	>
		<p>
			ตู้จะถ่ายภาพใบหน้าของท่านจากกล้อง
			เพื่อเทียบกับรูปถ่ายในชิปบัตรประชาชนว่าเป็นบุคคลเดียวกันหรือไม่
		</p>
		<p>
			<strong class="text-slate-900">ภาพใบหน้าจะไม่ถูกบันทึก</strong>
			ระบบเก็บเฉพาะผลการตรวจ (ยืนยันได้ หรือ ยืนยันไม่ได้)
		</p>
		<p class="font-semibold text-slate-900">
			หากไม่ยินยอม ท่านยังรับบริการได้ตามปกติ เจ้าหน้าที่จะตรวจสอบตัวตนให้แทน
		</p>
	</div>
	<div
		class="mt-7 flex flex-col-reverse gap-3 sm:flex-row kiosk-portrait:mt-10 kiosk-portrait:gap-4 kiosk-compact:mt-3"
	>
		<Button
			type="button"
			variant="outline"
			onclick={ondecline}
			class={`sm:flex-1 ${KIOSK_NOTICE_SECONDARY_ACTION}`}>ไม่ยินยอม ให้เจ้าหน้าที่ตรวจแทน</Button
		>
		<Button type="button" onclick={onagree} class={`sm:flex-1 ${KIOSK_NOTICE_PRIMARY_ACTION}`}
			>ยินยอม เริ่มตรวจใบหน้า</Button
		>
	</div>
</div>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { ConsentBlock, ConsentBlockState, type ConsentDecision } from '$lib/features/consent';
	import { KIOSK_NOTICE_SECONDARY_ACTION } from './kiosk-notice-actions';
	interface Props {
		/** Where the details come from: the card chip, or what ThaiD verified (no photo). */
		source?: 'smart-card' | 'thaid';
		onconsent: (decision: ConsentDecision) => void;
		oncancel: () => void;
	}
	let { source = 'smart-card', onconsent, oncancel }: Props = $props();

	const block = new ConsentBlockState({ channel: 'kiosk' });
</script>

<div
	class="mx-auto mt-6 flex w-full max-w-3xl flex-col gap-4 kiosk-compact:mt-0 kiosk-compact:gap-2"
>
	<section
		class="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-8 kiosk-portrait:p-8 kiosk-compact:p-4"
		aria-labelledby="consent-title"
	>
		<div
			class="mb-5 inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-900 kiosk-portrait:mb-6 kiosk-portrait:px-5 kiosk-portrait:py-2 kiosk-portrait:text-lg kiosk-compact:mb-2"
		>
			ก่อนเริ่มลงทะเบียน
		</div>
		<h1
			id="consent-title"
			class="text-2xl font-bold text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl kiosk-compact:text-2xl"
		>
			{source === 'thaid' ? 'ยินยอมให้ใช้ข้อมูลจาก ThaiD' : 'ยินยอมให้อ่านข้อมูลจากบัตรประชาชน'}
		</h1>
		<div
			class="mt-4 space-y-3 text-base leading-relaxed text-slate-700 kiosk-portrait:mt-6 kiosk-portrait:text-xl kiosk-compact:mt-2 kiosk-compact:space-y-1.5 kiosk-compact:leading-snug"
		>
			{#if source === 'thaid'}
				<p>
					ระบบจะใช้ชื่อและนามสกุล เลขบัตรประชาชน เพศ วันเกิด และที่อยู่ที่ยืนยันผ่าน ThaiD
					(ไม่มีรูปถ่าย) และเบอร์โทรศัพท์ที่ท่านกรอก (ถ้ามี) เพื่อสร้างรายการผู้ประสบภัยของศูนย์นี้
					และส่งข้อมูลให้เจ้าหน้าที่ตรวจสอบก่อนยืนยันการเข้าพัก
				</p>
			{:else}
				<p>
					ระบบจะอ่านชื่อและนามสกุล เลขบัตรประชาชน เพศ วันเกิด ที่อยู่ และรูปถ่ายจากชิปบัตร
					และเบอร์โทรศัพท์ที่ท่านกรอก (ถ้ามี) เพื่อสร้างรายการผู้ประสบภัยของศูนย์นี้
					และส่งข้อมูลให้เจ้าหน้าที่ตรวจสอบก่อนยืนยันการเข้าพัก
				</p>
			{/if}
			<p>
				ข้อมูลจะถูกเก็บในรายการที่รอยืนยัน และเจ้าหน้าที่จะตรวจสอบข้อมูลเมื่อท่านไปพบเจ้าหน้าที่
			</p>
			{#if source !== 'thaid'}
				<p class="font-semibold text-slate-900">
					กรุณาเสียบบัตรของผู้ที่ต้องการลงทะเบียน เมื่อหน้าจอแจ้งว่าลงทะเบียนสำเร็จแล้วจึงนำบัตรออก
				</p>
			{/if}
		</div>
	</section>
	<ConsentBlock {block} confirm="standalone" size="kiosk" showLinks={false} onconfirm={onconsent} />
	<Button type="button" variant="outline" onclick={oncancel} class={KIOSK_NOTICE_SECONDARY_ACTION}
		>ยกเลิก</Button
	>
</div>

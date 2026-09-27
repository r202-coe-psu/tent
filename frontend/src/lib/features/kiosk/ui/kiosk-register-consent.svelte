<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	interface Props {
		onconsent: () => void;
		oncancel: () => void;
	}
	let { onconsent, oncancel }: Props = $props();
</script>

<section
	class="mx-auto mt-6 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-8"
	aria-labelledby="consent-title"
>
	<div
		class="mb-5 inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-900"
	>
		ก่อนเริ่มลงทะเบียน
	</div>
	<h1 id="consent-title" class="text-2xl font-bold text-[#0A2647] sm:text-3xl">
		ยินยอมให้อ่านข้อมูลจากบัตรประชาชน
	</h1>
	<div class="mt-4 space-y-3 text-base leading-relaxed text-slate-700">
		<p>
			ระบบจะอ่านชื่อและนามสกุล เลขบัตรประชาชน เพศ วันเกิด ที่อยู่ และรูปถ่ายจากชิปบัตร
			เพื่อสร้างรายการผู้ประสบภัยของศูนย์นี้ และส่งข้อมูลให้เจ้าหน้าที่ตรวจสอบก่อนยืนยันการเข้าพัก
		</p>
		<p>ข้อมูลจะถูกเก็บในรายการที่รอยืนยัน และเจ้าหน้าที่จะตรวจสอบข้อมูลเมื่อท่านไปพบเจ้าหน้าที่</p>
		<p class="font-semibold text-slate-900">
			กรุณาเสียบบัตรของผู้ที่ต้องการลงทะเบียน เมื่อหน้าจอแจ้งว่าลงทะเบียนสำเร็จแล้วจึงนำบัตรออก
		</p>
	</div>
	<div class="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
		<Button type="button" variant="outline" onclick={oncancel} class="min-h-12 px-6 text-base"
			>ยกเลิก</Button
		>
		<Button
			type="button"
			onclick={onconsent}
			class="min-h-12 bg-[#0A2647] px-6 text-base font-bold text-white hover:bg-[#051930]"
			>ยินยอมและดำเนินการ</Button
		>
	</div>
</section>

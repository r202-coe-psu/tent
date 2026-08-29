<script lang="ts">
	import { page } from '$app/stores';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import DigitalPassCard from '$lib/features/volunteers/components/DigitalPassCard.svelte';
	import { PublicPageShell } from '$lib/features/public-portal';

	// Mock ticket data based on token
	let token = $derived($page.params.token ?? '');

	let ticket = $derived({
		token: token,
		jobTitle: 'ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC ม.อ.',
		shelter: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
		appliedAt: '2026-06-12T14:30:00Z',
		status: 'confirmed' as const,
		date: '13/06/2026',
		time: '08:00 - 12:00 น.',
		meetingPoint: 'จุดลงทะเบียนหน้าประตู 1',
		applicantName: 'สมชาย ใจดี',
		maskedPhone: '089-XXX-1234'
	});
</script>

<svelte:head>
	<title>ตั๋วดิจิทัลอาสาสมัคร (Digital Pass) - {token}</title>
</svelte:head>

<PublicPageShell class="space-y-6">
	<!-- Header -->
	<div class="mb-4">
		<a
			href="/volunteers/jobs"
			class="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="h-4 w-4" />
			กลับไปยังกระดานงาน
		</a>
	</div>

	<!-- Ticket Display -->
	<div class="py-4">
		<DigitalPassCard {ticket} />
	</div>

	<!-- Instructions -->
	<div
		class="mx-auto max-w-md rounded-2xl border border-warning/30 bg-warning/5 p-5 text-sm text-warning-foreground"
	>
		<h4 class="mb-2 flex items-center gap-2 font-bold">
			<span class="text-lg">💡</span> คำแนะนำก่อนเข้าปฏิบัติงาน
		</h4>
		<ul class="ml-5 list-disc space-y-1 text-xs leading-relaxed opacity-90">
			<li>โปรดบันทึกภาพหน้าจอนี้ไว้ หรือคัดลอกลิงก์เพื่อนำมาสแกนที่จุดเช็คอิน</li>
			<li>มาถึงก่อนเวลากะงานประมาณ 15 นาที เพื่อรับฟังบรรยายสรุป (Briefing)</li>
			<li>การแต่งกาย: สวมเสื้อผ้าที่ทะมัดทะแมง รองเท้าผ้าใบ ปิดมิดชิด</li>
			<li>หากไม่สามารถมาได้ โปรดกดยกเลิกกะล่วงหน้า เพื่อคืนโควตาให้ท่านอื่น</li>
		</ul>
	</div>
</PublicPageShell>

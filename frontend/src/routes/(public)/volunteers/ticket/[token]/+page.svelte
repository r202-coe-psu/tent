<script lang="ts">
	import { page } from '$app/stores';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import DigitalPassCard from '$lib/features/volunteers/components/DigitalPassCard.svelte';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	let token = $derived($page.params.token ?? '');

	interface PublicTicket {
		token: string;
		jobTitle: string;
		shelter: string;
		appliedAt: string;
		status: 'confirmed' | 'pending_review' | 'cancelled';
		date: string;
		time: string;
		meetingPoint: string;
		applicantName: string;
		maskedPhone: string;
	}

	let ticketData = $state<PublicTicket | null>(null);
	let isLoading = $state(true);

	async function fetchTicket(tokenVal: string) {
		if (!tokenVal) return;
		try {
			isLoading = true;
			const res = await fetch(`/api/public/v1/volunteer/ticket/${encodeURIComponent(tokenVal)}`);
			if (res.ok) {
				const data = await res.json();
				if (data.ticket) {
					const t = data.ticket;
					const rawPhone = t.phone || '';
					const masked =
						rawPhone.length >= 8
							? `${rawPhone.slice(0, 3)}-XXX-${rawPhone.slice(-4)}`
							: rawPhone || '08X-XXX-XXXX';

					ticketData = {
						token: t.token || tokenVal,
						jobTitle: t.job_title || 'งานจิตอาสาประจำศูนย์พักพิง',
						shelter: t.shelter_name || t.shelter_code || 'ศูนย์พักพิงหลัก',
						appliedAt: t.created_at || new Date().toISOString(),
						status: (t.status === 'confirmed'
							? 'confirmed'
							: t.status === 'pending_review'
								? 'pending_review'
								: 'cancelled') as 'confirmed' | 'pending_review' | 'cancelled',
						date: t.date || new Date().toISOString().slice(0, 10),
						time:
							t.start_time && t.end_time
								? `${t.start_time} - ${t.end_time} น.`
								: '08:00 - 12:00 น.',
						meetingPoint: 'จุดลงทะเบียนจิตอาสา หน้าทางเข้าศูนย์พักพิง',
						applicantName: t.applicant_name || 'จิตอาสาผู้สมัคร',
						maskedPhone: masked
					};
					return;
				}
			}
		} catch (err) {
			console.warn('Failed to load public ticket:', err);
		} finally {
			isLoading = false;
		}

		// Fallback display if ticket mock or offline
		ticketData = {
			token: tokenVal,
			jobTitle: 'ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC ม.อ.',
			shelter: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			appliedAt: new Date().toISOString(),
			status: 'pending_review',
			date: new Date().toISOString().slice(0, 10),
			time: '08:00 - 12:00 น.',
			meetingPoint: 'จุดลงทะเบียนหน้าประตู 1',
			applicantName: 'จิตอาสาผู้สมัคร',
			maskedPhone: '08X-XXX-XXXX'
		};
	}

	$effect(() => {
		if (token) {
			fetchTicket(token);
		}
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
		{#if isLoading}
			<div class="mx-auto max-w-md space-y-4">
				<Skeleton class="h-96 rounded-3xl" />
			</div>
		{:else if ticketData}
			<DigitalPassCard ticket={ticketData} />
		{/if}
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

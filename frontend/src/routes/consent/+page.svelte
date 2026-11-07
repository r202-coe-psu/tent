<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		CONSENT_ROUTE,
		LANDING_ROUTE,
		LOGIN_ROUTE,
		resolvePostLoginDestination
	} from '$lib/guards/auth';
	import { authStore } from '$lib/stores/auth.svelte';
	import { fetchAuthStatus, invalidateAuthStatusRequest, submitConsent } from '$lib/features/users';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import FileText from '@lucide/svelte/icons/file-text';
	import Lock from '@lucide/svelte/icons/lock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';

	let agreedNda = $state(false);
	let agreedPdpa = $state(false);
	let loading = $state(false);
	let currentUsername = $state('');

	const canSubmit = $derived(agreedNda && agreedPdpa && !loading);

	onMount(async () => {
		try {
			const status = await fetchAuthStatus();
			const dest = resolvePostLoginDestination(status);
			if (dest !== CONSENT_ROUTE) {
				await goto(resolve(dest));
				return;
			}
			currentUsername = status.name;
		} catch {
			await goto(resolve(LOGIN_ROUTE));
		}
	});

	async function handleAccept() {
		if (!canSubmit) return;
		loading = true;
		try {
			await submitConsent(true);
			invalidateAuthStatusRequest();
			toast.success('บันทึกความยินยอมและเข้าสู่ระบบเรียบร้อย');
			await goto(resolve(LANDING_ROUTE));
		} catch {
			toast.error('ไม่สามารถบันทึกความยินยอมได้ กรุณาลองใหม่อีกครั้ง');
		} finally {
			loading = false;
		}
	}

	async function handleDecline() {
		try {
			await authStore.logout();
			toast.error('คุณปฏิเสธข้อตกลงความปลอดภัย จำเป็นต้องออกจากระบบ');
			await goto(resolve(LOGIN_ROUTE));
		} catch {
			await goto(resolve(LOGIN_ROUTE));
		}
	}
</script>

<svelte:head>
	<title>ข้อตกลงและเงื่อนไขการคุ้มครองข้อมูล (PDPA & NDA) — Smart Shelter</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-6 lg:p-8">
	<div class="w-full max-w-2xl">
		<Card.Root class="overflow-hidden border-slate-200 bg-white shadow-sm">
			<Card.Header class="border-b border-amber-200/60 bg-amber-500/10 pb-5">
				<div class="flex items-center gap-3">
					<div class="rounded-xl bg-amber-500/20 p-2.5 text-amber-700">
						<ShieldAlert class="h-6 w-6" />
					</div>
					<div>
						<Card.Title class="text-xl font-bold text-slate-900 sm:text-2xl">
							ข้อกำหนดความปลอดภัยข้อมูลส่วนบุคคล (PDPA & NDA)
						</Card.Title>
						<Card.Description class="mt-1 text-sm text-slate-600">
							สำหรับเจ้าหน้าที่และจิตอาสาปฏิบัติงานในศูนย์พักพิงฉุกเฉิน
							{#if currentUsername}
								<span class="mt-0.5 block text-xs text-slate-500"
									>เข้าสู่ระบบในชื่อ: <strong>{currentUsername}</strong></span
								>
							{/if}
						</Card.Description>
					</div>
				</div>
			</Card.Header>

			<Card.Content class="space-y-6 p-6">
				<!-- Article 1: NDA -->
				<section class="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
					<div class="flex items-start gap-3">
						<div class="mt-0.5 shrink-0 rounded-lg bg-red-100 p-1.5 text-red-700">
							<Lock class="h-4 w-4" />
						</div>
						<div class="space-y-1">
							<h3 class="text-sm font-semibold text-slate-900">
								1. ข้อตกลงไม่เปิดเผยข้อมูลผู้ประสบภัย (Non-Disclosure Agreement)
							</h3>
							<p class="text-xs leading-relaxed text-slate-600 sm:text-sm">
								ข้อมูลของผู้ประสบภัย ผู้อพยพ ข้อมูลทางการแพทย์ ความต้องการพิเศษ
								และประวัติครอบครัวในระบบนี้ เป็นข้อมูลส่วนบุคคลที่มีความอ่อนไหวสูง
								ข้าพเจ้าสัญญาว่าจะรักษาเป็นความลับสูงสุด จะไม่คัดลอก ถ่ายภาพ นำออก เผยแพร่
								หรือส่งต่อแก่บุคคลภายนอกหรือสื่อสังคมออนไลน์โดยเด็ดขาด
								เว้นแต่เป็นการปฏิบัติหน้าที่ตามที่ได้รับมอบหมาย
							</p>
						</div>
					</div>
					<div class="border-t border-slate-200/60 pt-2">
						<label
							class="flex cursor-pointer items-start gap-2.5 text-xs font-medium text-slate-800 sm:text-sm"
						>
							<input
								id="consent-nda"
								type="checkbox"
								class="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
								bind:checked={agreedNda}
							/>
							<span>ข้าพเจ้าเข้าใจและยอมรับข้อตกลงการรักษาความลับ ไม่เผยแพร่ข้อมูลผู้ประสบภัย</span>
						</label>
					</div>
				</section>

				<!-- Article 2: PDPA -->
				<section class="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
					<div class="flex items-start gap-3">
						<div class="mt-0.5 shrink-0 rounded-lg bg-blue-100 p-1.5 text-blue-700">
							<FileText class="h-4 w-4" />
						</div>
						<div class="space-y-1">
							<h3 class="text-sm font-semibold text-slate-900">
								2. ความยินยอมประมวลผลข้อมูลส่วนบุคคลของตนเอง (PDPA Consent)
							</h3>
							<p class="text-xs leading-relaxed text-slate-600 sm:text-sm">
								ข้าพเจ้ายินยอมให้ศูนย์พักพิงและระบบบริหารจัดการภัยพิบัติ เก็บรวบรวม บันทึก ใช้
								และประมวลผลข้อมูลส่วนบุคคล ข้อมูลติดต่อ ทักษะวิชาชีพ
								และประวัติการปฏิบัติงานของข้าพเจ้า เพื่อวัตถุประสงค์ในการจัดสรรภารกิจ
								ตรวจสอบสิทธิ์การเข้าใช้งานระบบ และประสานงานความช่วยเหลือตามระเบียบ พ.ร.บ.
								คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
							</p>
						</div>
					</div>
					<div class="border-t border-slate-200/60 pt-2">
						<label
							class="flex cursor-pointer items-start gap-2.5 text-xs font-medium text-slate-800 sm:text-sm"
						>
							<input
								id="consent-pdpa"
								type="checkbox"
								class="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
								bind:checked={agreedPdpa}
							/>
							<span>ข้าพเจ้ายินยอมให้จัดเก็บและประมวลผลข้อมูลส่วนบุคคลของข้าพเจ้าตามข้อกำหนด</span>
						</label>
					</div>
				</section>

				<div
					class="flex items-center gap-2 rounded-lg border border-amber-200/70 bg-amber-50 p-3 text-xs text-amber-800"
				>
					<ShieldAlert class="h-4 w-4 shrink-0 text-amber-600" />
					<span
						>หากไม่ยอมรับข้อกำหนดข้างต้น ท่านจะไม่สามารถเข้าสู่ระบบปฏิบัติงานได้
						และระบบจะนำท่านออกจากระบบโดยอัตโนมัติ</span
					>
				</div>
			</Card.Content>

			<Card.Footer
				class="flex flex-col-reverse items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:p-6"
			>
				<Button
					id="btn-decline-consent"
					type="button"
					variant="ghost"
					class="w-full text-slate-600 hover:bg-red-50 hover:text-red-700 sm:w-auto"
					onclick={handleDecline}
				>
					<LogOut class="mr-2 h-4 w-4" />
					ไม่ยินยอม (ออกจากระบบ)
				</Button>

				<Button
					id="btn-accept-consent"
					type="button"
					class="w-full bg-amber-600 font-medium text-white hover:bg-amber-700 sm:w-auto"
					disabled={!canSubmit}
					onclick={handleAccept}
				>
					<CheckCircle2 class="mr-2 h-4 w-4" />
					{loading ? 'กำลังบันทึก...' : 'ยอมรับข้อตกลงและเข้าสู่ระบบ'}
				</Button>
			</Card.Footer>
		</Card.Root>
	</div>
</main>

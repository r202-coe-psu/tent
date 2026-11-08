<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
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
	import { roleDisplayLabel } from '$lib/auth/roles';
	import { fetchAuthStatus, invalidateAuthStatusRequest, submitConsent } from '$lib/features/users';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import FileText from '@lucide/svelte/icons/file-text';
	import Lock from '@lucide/svelte/icons/lock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import UserCheck from '@lucide/svelte/icons/user-check';

	let agreedNda = $state(false);
	let agreedPdpa = $state(false);
	let loading = $state(false);
	let currentUsername = $state('');
	let currentUserRoles = $state<readonly string[]>([]);
	let currentPersonnelType = $state<'staff' | 'volunteer' | null>(null);

	const canSubmit = $derived(agreedNda && agreedPdpa && !loading);

	const roleLabel = $derived.by(() => {
		if (currentUserRoles.length > 0) {
			const primary = currentUserRoles.find((r) => !r.startsWith('shelter:'));
			if (primary) return roleDisplayLabel(primary);
		}
		if (currentPersonnelType === 'staff') return 'เจ้าหน้าที่ปฏิบัติงาน';
		if (currentPersonnelType === 'volunteer') return 'จิตอาสา';
		return 'ผู้ปฏิบัติงานในศูนย์';
	});

	onMount(async () => {
		try {
			const status = await fetchAuthStatus();
			const dest = resolvePostLoginDestination(status);
			if (dest !== CONSENT_ROUTE) {
				await goto(resolve(dest));
				return;
			}
			currentUsername = status.name;
			currentUserRoles = status.roles ?? [];
			currentPersonnelType = status.personnel_type ?? null;
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
	<title>ข้อกำหนดความปลอดภัยข้อมูลส่วนบุคคล (PDPA & NDA) — Smart Shelter</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-6 lg:p-8">
	<div class="w-full max-w-2xl py-6">
		<Card.Root class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<!-- Header -->
			<Card.Header class="border-b border-slate-100 bg-white p-6 pb-5 sm:p-8 sm:pb-6">
				<div class="flex items-start gap-4">
					<div
						class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-[#0A2647]"
					>
						<ShieldCheck class="size-6 text-[#0A2647]" />
					</div>
					<div class="space-y-1.5">
						<div class="flex flex-wrap items-center gap-2">
							<Badge
								variant="outline"
								class="border-blue-200 bg-blue-50/60 font-medium text-blue-900"
							>
								ระเบียบความปลอดภัยข้อมูล
							</Badge>
						</div>
						<Card.Title class="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
							ข้อกำหนดความปลอดภัยข้อมูลส่วนบุคคล (PDPA & NDA)
						</Card.Title>
						<Card.Description class="text-sm leading-normal text-slate-600 sm:text-base">
							สำหรับเจ้าหน้าที่และจิตอาสาปฏิบัติงานในศูนย์พักพิงฉุกเฉิน
						</Card.Description>

						{#if currentUsername}
							<div
								class="mt-3 inline-flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-1.5 text-xs text-slate-700"
							>
								<UserCheck class="size-3.5 text-emerald-600" />
								<span
									>เข้าสู่ระบบในชื่อ: <strong class="text-slate-900">{currentUsername}</strong
									></span
								>
								<span class="text-slate-300">•</span>
								<span class="font-medium text-slate-600">{roleLabel}</span>
							</div>
						{/if}
					</div>
				</div>
			</Card.Header>

			<!-- Content Clauses -->
			<Card.Content class="space-y-5 p-6 sm:p-8">
				<!-- Article 1: NDA -->
				<div
					class="relative rounded-xl border border-slate-200/90 bg-white p-5 transition-colors hover:border-slate-300"
				>
					<div class="flex items-start gap-3.5">
						<div
							class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700"
						>
							<Lock class="size-4" />
						</div>
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<Badge
									variant="secondary"
									class="bg-slate-100 text-xs font-semibold text-slate-700"
								>
									ข้อที่ 1
								</Badge>
								<h3 class="text-sm font-semibold text-slate-900 sm:text-base">
									ข้อตกลงไม่เปิดเผยข้อมูลผู้ประสบภัย (Non-Disclosure Agreement)
								</h3>
							</div>
							<p class="text-sm leading-relaxed text-slate-600">
								ข้อมูลของผู้ประสบภัย ผู้อพยพ ข้อมูลทางการแพทย์ ความต้องการพิเศษ
								และประวัติครอบครัวในระบบนี้ เป็นข้อมูลส่วนบุคคลที่มีความอ่อนไหวสูง
								ข้าพเจ้าสัญญาว่าจะรักษาเป็นความลับสูงสุด จะไม่คัดลอก ถ่ายภาพ นำออก เผยแพร่
								หรือส่งต่อแก่บุคคลภายนอกหรือสื่อสังคมออนไลน์โดยเด็ดขาด
								เว้นแต่เป็นการปฏิบัติหน้าที่ตามที่ได้รับมอบหมายอย่างเป็นทางการ
							</p>
						</div>
					</div>

					<div class="mt-4 border-t border-slate-100 pt-3.5">
						<label
							for="consent-nda"
							class="flex cursor-pointer items-start gap-3 rounded-lg p-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
						>
							<input
								id="consent-nda"
								type="checkbox"
								bind:checked={agreedNda}
								class="mt-0.5 size-4.5 rounded border-slate-300 text-[#0A2647] focus:ring-[#0A2647]"
							/>
							<span class="leading-snug"
								>ข้าพเจ้าเข้าใจและยอมรับข้อตกลงการรักษาความลับ ไม่เผยแพร่ข้อมูลผู้ประสบภัย</span
							>
						</label>
					</div>
				</div>

				<!-- Article 2: PDPA -->
				<div
					class="relative rounded-xl border border-slate-200/90 bg-white p-5 transition-colors hover:border-slate-300"
				>
					<div class="flex items-start gap-3.5">
						<div
							class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#0A2647]"
						>
							<FileText class="size-4" />
						</div>
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<Badge
									variant="secondary"
									class="bg-slate-100 text-xs font-semibold text-slate-700"
								>
									ข้อที่ 2
								</Badge>
								<h3 class="text-sm font-semibold text-slate-900 sm:text-base">
									ความยินยอมประมวลผลข้อมูลส่วนบุคคลของตนเอง (PDPA Consent)
								</h3>
							</div>
							<p class="text-sm leading-relaxed text-slate-600">
								ข้าพเจ้ายินยอมให้ศูนย์พักพิงและระบบบริหารจัดการภัยพิบัติ เก็บรวบรวม บันทึก ใช้
								และประมวลผลข้อมูลส่วนบุคคล ข้อมูลติดต่อ ทักษะวิชาชีพ
								และประวัติการปฏิบัติงานของข้าพเจ้า เพื่อวัตถุประสงค์ในการจัดสรรภารกิจ
								ตรวจสอบสิทธิ์การเข้าใช้งานระบบ และประสานงานความช่วยเหลือตามระเบียบ พ.ร.บ.
								คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
							</p>
						</div>
					</div>

					<div class="mt-4 border-t border-slate-100 pt-3.5">
						<label
							for="consent-pdpa"
							class="flex cursor-pointer items-start gap-3 rounded-lg p-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
						>
							<input
								id="consent-pdpa"
								type="checkbox"
								bind:checked={agreedPdpa}
								class="mt-0.5 size-4.5 rounded border-slate-300 text-[#0A2647] focus:ring-[#0A2647]"
							/>
							<span class="leading-snug"
								>ข้าพเจ้ายินยอมให้จัดเก็บและประมวลผลข้อมูลส่วนบุคคลของข้าพเจ้าตามข้อกำหนด</span
							>
						</label>
					</div>
				</div>

				<!-- Warning Advisory -->
				<div
					class="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/80 p-3.5 text-xs text-amber-900 sm:text-sm"
				>
					<AlertCircle class="mt-0.5 size-4 shrink-0 text-amber-600" />
					<p class="leading-relaxed">
						<strong>เงื่อนไขการปฏิบัติหน้าที่:</strong> หากท่านไม่ยอมรับข้อกำหนดข้างต้น จะไม่สามารถเข้าใช้งานระบบได้
						และระบบจะนำท่านออกจากระบบโดยอัตโนมัติ
					</p>
				</div>
			</Card.Content>

			<!-- Footer Actions -->
			<Card.Footer
				class="flex flex-col-reverse items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 p-4 sm:flex-row sm:px-8 sm:py-5"
			>
				<Button
					id="btn-decline-consent"
					type="button"
					variant="ghost"
					class="w-full text-slate-600 hover:bg-red-50 hover:text-red-700 sm:w-auto"
					onclick={handleDecline}
				>
					<LogOut class="mr-2 size-4" />
					ไม่ยินยอม (ออกจากระบบ)
				</Button>

				<Button
					id="btn-accept-consent"
					type="button"
					class="w-full bg-[#0A2647] text-white shadow-xs hover:bg-[#051930] sm:w-auto"
					disabled={!canSubmit}
					onclick={handleAccept}
				>
					<CheckCircle2 class="mr-2 size-4" />
					{loading ? 'กำลังบันทึกความยินยอม...' : 'ยินยอมและเริ่มปฏิบัติงาน'}
				</Button>
			</Card.Footer>
		</Card.Root>
	</div>
</main>

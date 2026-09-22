<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import MessageCircleQuestion from '@lucide/svelte/icons/message-circle-question';
	import Phone from '@lucide/svelte/icons/phone';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		IDENTITY_METHODS,
		type IdentityMethodDefinition,
		type IdentityMethodId
	} from '../domain/identity-method';

	interface Props {
		contextQuery: string;
	}

	let { contextQuery }: Props = $props();
	let assistanceOpen = $state(false);
	let navigatingId = $state<IdentityMethodId | null>(null);

	function hrefFor(method: IdentityMethodDefinition): string | undefined {
		return method.href ? `${method.href}${contextQuery}` : undefined;
	}

	function iconFor(icon: IdentityMethodDefinition['icon']) {
		if (icon === 'qr') return QrCode;
		if (icon === 'card') return CreditCard;
		if (icon === 'phone') return Phone;
		return Smartphone;
	}

	async function navigateTo(event: MouseEvent, method: IdentityMethodDefinition): Promise<void> {
		event.preventDefault();
		if (!method.enabled || !method.href || navigatingId) return;

		navigatingId = method.id;
		try {
			await goto(hrefFor(method) ?? method.href);
		} catch {
			navigatingId = null;
		}
	}
</script>

<section class="mx-auto w-full max-w-7xl">
	<div class="mx-auto mb-6 max-w-3xl text-center lg:mx-0 lg:text-left">
		<p class="mb-2 text-sm font-bold tracking-wide text-[#0A2647] sm:text-base">
			เริ่มต้นการลงทะเบียน
		</p>
		<h1 class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl">
			เลือกวิธียืนยันตัวตน
		</h1>
		<p class="mt-2 text-base leading-relaxed font-medium text-slate-700 sm:text-lg">
			เลือกวิธีที่สะดวกสำหรับคุณ ระบบจะพาไปยังขั้นตอนถัดไป
		</p>
	</div>

	<div class="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="วิธียืนยันตัวตน">
		{#each IDENTITY_METHODS as method (method.id)}
			{@const MethodIcon = iconFor(method.icon)}
			<article
				class={`flex min-h-[14rem] flex-col rounded-xl border bg-white p-4 shadow-2xs transition-colors sm:min-h-[15rem] sm:p-5 ${
					method.enabled
						? 'border-[#CBD5E1] hover:border-[#0A2647]'
						: 'border-slate-200 bg-slate-50'
				}`}
			>
				<div class="flex items-start justify-between gap-3">
					<div class="flex items-start gap-3">
						<div
							class={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
								method.enabled ? 'bg-[#F0F4F8] text-[#0A2647]' : 'bg-slate-200 text-slate-600'
							}`}
							aria-hidden="true"
						>
							<MethodIcon class="h-6 w-6" />
						</div>
						<div>
							<h2 class="text-lg leading-snug font-bold text-slate-900 sm:text-xl">
								{method.title}
							</h2>
							{#if !method.enabled}
								<span
									class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-700"
								>
									<Clock3 class="h-4 w-4" aria-hidden="true" />
									เร็ว ๆ นี้
								</span>
							{/if}
						</div>
					</div>
				</div>

				<p class="mt-3 text-sm leading-relaxed text-slate-700 sm:text-base">{method.description}</p>

				{#if method.facts.length > 0}
					<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm font-semibold text-slate-600">
						{#each method.facts as fact (fact)}
							<li class="flex items-center gap-2">
								<span class="h-1.5 w-1.5 rounded-full bg-[#0A2647]" aria-hidden="true"></span>
								{fact}
							</li>
						{/each}
					</ul>
				{/if}

				<div class="mt-auto pt-4">
					{#if method.enabled}
						<Button
							href={hrefFor(method)}
							onclick={(event) => navigateTo(event, method)}
							disabled={navigatingId !== null}
							class="min-h-12 w-full gap-2 bg-[#0A2647] px-3 text-sm font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none sm:px-4 sm:text-base"
						>
							<span
								>{navigatingId === method.id ? 'กำลังเปิดขั้นตอนถัดไป…' : method.buttonLabel}</span
							>
							<ArrowRight class="h-5 w-5" aria-hidden="true" />
						</Button>
					{:else}
						<button
							type="button"
							disabled
							class="min-h-12 w-full cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-3 text-sm font-bold text-slate-700 opacity-100 sm:px-4 sm:text-base"
						>
							{method.buttonLabel}
						</button>
					{/if}
				</div>
			</article>
		{/each}
	</div>

	<section
		class="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5"
		aria-labelledby="assistance-title"
	>
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-start gap-3">
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
					aria-hidden="true"
				>
					<CircleHelp class="h-6 w-6" />
				</div>
				<div>
					<h2 id="assistance-title" class="text-lg font-bold text-slate-900 sm:text-xl">
						ไม่มีบัตร หรือต้องการความช่วยเหลือ?
					</h2>
					<p class="mt-2 text-base leading-relaxed text-slate-700">
						เจ้าหน้าที่ประจำจุดสามารถช่วยตรวจสอบและบอกขั้นตอนที่เหมาะสมได้
					</p>
				</div>
			</div>
			<Button
				variant="outline"
				aria-expanded={assistanceOpen}
				aria-controls="kiosk-assistance-panel"
				onclick={() => (assistanceOpen = !assistanceOpen)}
				class="min-h-12 w-full shrink-0 border-[#CBD5E1] px-5 text-base font-bold text-[#0A2647] hover:bg-[#F0F4F8] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none sm:w-auto"
			>
				<MessageCircleQuestion class="h-5 w-5" aria-hidden="true" />
				{assistanceOpen ? 'ซ่อนรายละเอียด' : 'ดูวิธีขอความช่วยเหลือ'}
			</Button>
		</div>

		{#if assistanceOpen}
			<div
				id="kiosk-assistance-panel"
				class="mt-5 rounded-xl border border-[#CBD5E1] bg-[#F0F4F8] p-5"
				role="region"
				aria-labelledby="assistance-title"
			>
				<div class="flex items-start gap-3">
					<Phone class="mt-0.5 h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />
					<div class="space-y-2">
						<h3 class="text-lg font-bold text-[#0A2647]">กรุณาติดต่อเจ้าหน้าที่ประจำจุด</h3>
						<p class="text-base leading-relaxed text-slate-700">
							แจ้งเจ้าหน้าที่ว่าต้องการลงทะเบียนโดยไม่มีบัตร หรือไม่สามารถใช้วิธีด้านบนได้
						</p>
					</div>
				</div>
				<Button
					variant="outline"
					onclick={() => (assistanceOpen = false)}
					class="mt-4 min-h-12 border-[#CBD5E1] bg-white px-5 text-base font-bold text-[#0A2647] hover:bg-[#F0F4F8] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none"
				>
					ปิดรายละเอียด
				</Button>
			</div>
		{/if}
	</section>

	<div
		class="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-2xs sm:text-base"
	>
		<ShieldCheck class="mt-0.5 h-5 w-5 shrink-0 text-[#0A2647]" aria-hidden="true" />
		<p>ระบบจะยังไม่อ่านหรือบันทึกข้อมูล จนกว่าคุณจะเริ่มขั้นตอนยืนยันตัวตน</p>
	</div>
</section>

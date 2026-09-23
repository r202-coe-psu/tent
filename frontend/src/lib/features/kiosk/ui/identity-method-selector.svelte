<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Phone from '@lucide/svelte/icons/phone';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import { Button } from '$lib/components/ui/button/index.js';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import { IDENTITY_METHODS, type IdentityMethodDefinition } from '../domain/identity-method';

	interface Props {
		contextQuery: string;
	}

	let { contextQuery }: Props = $props();

	function hrefFor(method: IdentityMethodDefinition): string | undefined {
		return method.href ? `${method.href}${contextQuery}` : undefined;
	}

	function iconFor(icon: IdentityMethodDefinition['icon']) {
		if (icon === 'qr') return QrCode;
		if (icon === 'card') return CreditCard;
		if (icon === 'phone') return Phone;
		return Smartphone;
	}

	function cardTone(id: IdentityMethodDefinition['id']): string {
		if (id === 'qr') return 'border-sky-200 bg-sky-50';
		if (id === 'smart-card') return 'border-[#CBD5E1] bg-[#F0F4F8]';
		if (id === 'phone') return 'border-amber-200 bg-amber-50';
		return 'border-violet-200 bg-violet-50';
	}

	function iconTone(id: IdentityMethodDefinition['id']): string {
		if (id === 'qr') return 'bg-white text-sky-800';
		if (id === 'smart-card') return 'bg-[#0A2647] text-white';
		if (id === 'phone') return 'bg-white text-amber-800';
		return 'bg-white text-[#1E3A8A]';
	}

	function buttonTone(id: IdentityMethodDefinition['id']): string {
		return id === 'qr' ? 'bg-[#0284C7] hover:bg-sky-800' : 'bg-[#0A2647] hover:bg-[#051930]';
	}
</script>

<section
	class="kiosk-method-page mx-auto flex w-full max-w-5xl flex-col gap-4"
	aria-labelledby="method-title"
>
	<KioskCheckInWizard currentStep={1} />

	<header class="text-center">
		<h1 id="method-title" class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl">
			รายงานตัว
		</h1>
		<p class="mt-1 text-base font-medium text-slate-700">เลือกวิธีค้นหา</p>
	</header>

	<div class="method-grid grid grid-cols-2 gap-3 sm:gap-4" aria-label="วิธีค้นหาข้อมูล">
		{#each IDENTITY_METHODS as method (method.id)}
			{@const MethodIcon = iconFor(method.icon)}
			<article
				class={`method-card flex flex-col justify-between rounded-xl border p-3 shadow-2xs sm:p-4 ${cardTone(method.id)}`}
			>
				<div class="flex items-center gap-3">
					<div
						class={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconTone(method.id)}`}
						aria-hidden="true"
					>
						<MethodIcon class="h-6 w-6" />
					</div>
					<div class="min-w-0">
						<h2 class="text-lg leading-snug font-bold text-slate-900 sm:text-xl">
							{method.title}
						</h2>
						{#if method.description}
							<p class="method-description mt-1 text-base leading-snug text-slate-700">
								{method.description}
							</p>
						{/if}
					</div>
				</div>

				{#if method.enabled}
					<Button
						href={hrefFor(method)}
						aria-label={method.buttonLabel}
						class={`method-action mt-3 min-h-12 w-full justify-between gap-2 px-3 text-base font-bold text-white focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none sm:px-4 ${buttonTone(method.id)}`}
					>
						<span>{method.buttonLabel}</span>
						<ArrowRight class="h-5 w-5" aria-hidden="true" />
					</Button>
				{:else}
					<button
						type="button"
						disabled
						class="method-action mt-3 min-h-12 w-full cursor-not-allowed rounded-lg border border-slate-300 bg-white/70 px-3 text-base font-bold text-slate-700 opacity-100 sm:px-4"
					>
						ยังไม่เปิดใช้
					</button>
				{/if}
			</article>
		{/each}
	</div>
</section>

<style>
	.kiosk-method-page {
		min-height: calc(100svh - 8rem);
		justify-content: flex-start;
	}

	.method-card {
		min-height: clamp(9.5rem, calc((100svh - 20rem) / 2), 30rem);
	}

	@media (max-height: 650px) {
		.kiosk-method-page {
			min-height: auto;
			justify-content: flex-start;
			gap: 0.5rem;
		}

		.method-grid {
			gap: 0.5rem;
		}

		.method-card {
			min-height: 9.5rem;
			padding: 0.75rem;
		}

		.method-action {
			margin-top: 0.5rem;
		}
	}
</style>

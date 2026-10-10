<script lang="ts">
	import type { Component } from 'svelte';
	import { resolve } from '$app/paths';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Phone from '@lucide/svelte/icons/phone';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import { visibleIdentityMethods, type IdentityMethodDefinition } from '../domain/identity-method';
	import type { KioskContextQuery } from '../domain/display-context';

	interface Props {
		contextQuery: KioskContextQuery;
		phoneCheckInEnabled: boolean;
	}

	let { contextQuery, phoneCheckInEnabled }: Props = $props();
	const methods = $derived(visibleIdentityMethods({ phoneCheckInEnabled }));
	const columns = $derived(methods.length === 3 ? 3 : 2);
	const rows = $derived(Math.ceil(methods.length / columns));

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
</script>

<section
	class="kiosk-method-page mx-auto flex w-full max-w-5xl flex-col gap-4 kiosk-portrait:gap-6"
	aria-labelledby="method-title"
>
	<KioskCheckInWizard currentStep={1} />

	<header class="text-center">
		<h1
			id="method-title"
			class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl"
		>
			รายงานตัว
		</h1>
		<p class="mt-1 text-base font-medium text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
			เลือกวิธีค้นหา
		</p>
	</header>

	{#snippet methodDetails(method: IdentityMethodDefinition, MethodIcon: Component)}
		<div
			class="flex flex-col items-center justify-center gap-3 text-center kiosk-portrait:flex-1 kiosk-portrait:flex-row kiosk-portrait:justify-start kiosk-portrait:gap-6 kiosk-portrait:text-left"
		>
			<div
				class={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl kiosk-portrait:h-20 kiosk-portrait:w-20 ${iconTone(method.id)}`}
				aria-hidden="true"
			>
				<MethodIcon class="h-6 w-6 kiosk-portrait:h-10 kiosk-portrait:w-10" />
			</div>
			<div class="min-w-0">
				<h2
					class="text-lg leading-snug font-bold text-slate-900 sm:text-xl kiosk-portrait:text-3xl"
				>
					{method.title}
				</h2>
				{#if method.description}
					<p
						class="method-description mt-1 text-base leading-snug text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl"
					>
						{method.description}
					</p>
				{/if}
			</div>
		</div>
	{/snippet}

	<div
		class={[
			'method-grid grid gap-3 sm:gap-4 kiosk-portrait:grid-cols-1 kiosk-portrait:gap-5',
			columns === 3 && 'grid-cols-3',
			columns === 2 && 'grid-cols-2'
		]}
		data-single-row={rows === 1 ? '' : undefined}
		style:--method-rows={rows}
		style:--method-count={methods.length}
		aria-label="วิธีค้นหาข้อมูล"
	>
		{#each methods as method (method.id)}
			{@const MethodIcon = iconFor(method.icon)}
			{#if method.enabled && method.href}
				<a
					href={resolve(`${method.href}${contextQuery}`)}
					aria-label={`${method.title}${method.description ? ` · ${method.description}` : ''} · ${method.buttonLabel}`}
					class={`method-card flex flex-col items-center justify-center gap-3 rounded-xl border p-3 text-center no-underline shadow-2xs transition-transform duration-150 ease-out hover:z-10 hover:scale-[1.02] focus-visible:z-10 focus-visible:scale-[1.02] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:focus-visible:scale-100 sm:p-4 kiosk-portrait:flex-row kiosk-portrait:justify-start kiosk-portrait:px-8 ${cardTone(method.id)}`}
				>
					{@render methodDetails(method, MethodIcon)}
				</a>
			{:else}
				<article
					class={`method-card flex flex-col items-center justify-center gap-3 rounded-xl border p-3 text-center shadow-2xs sm:p-4 kiosk-portrait:flex-row kiosk-portrait:justify-between kiosk-portrait:px-8 ${cardTone(method.id)}`}
				>
					{@render methodDetails(method, MethodIcon)}
					<p class="text-sm font-semibold text-slate-600 kiosk-portrait:text-xl">
						{method.buttonLabel}
					</p>
				</article>
			{/if}
		{/each}
	</div>
</section>

<style>
	.kiosk-method-page {
		min-height: calc(100svh - 8rem);
		justify-content: flex-start;
	}

	.method-card {
		min-height: clamp(9.5rem, calc((100svh - 20rem) / var(--method-rows, 2)), 30rem);
	}

	@media (max-width: 640px) {
		.method-grid[data-single-row] .method-card {
			padding: 0.5rem;
		}

		.method-grid[data-single-row] .method-description {
			display: none;
		}
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
	}

	/* 24" portrait: four stacked cards fill the middle/lower screen (spec §4.2). */
	@media screen and (orientation: portrait) and (min-height: 1200px) {
		.kiosk-method-page {
			/* 100svh minus header (5rem) + banner + main padding. */
			min-height: calc(100svh - 11rem);
		}

		.method-card {
			min-height: clamp(8rem, calc((100svh - 24rem) / var(--method-count, 4)), 15rem);
		}
	}
</style>

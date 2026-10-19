<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import Users from '@lucide/svelte/icons/users';
	import { resolve } from '$app/paths';
	import { navigateToKioskHome } from '../application/kiosk-navigation';
	import type { KioskContextQuery } from '../domain/display-context';
	import { KIOSK_REPRINT_PATH, KIOSK_VOLUNTEER_CARD_PATH } from '../domain/identity-method';
	import KioskBackButton from './kiosk-back-button.svelte';
	import { KioskIdleTimeout, KIOSK_IDLE_TIMEOUT_MS } from './kiosk-idle-timeout.svelte.js';

	interface Props {
		contextQuery: KioskContextQuery;
	}

	let { contextQuery }: Props = $props();

	interface PrintTarget {
		id: 'evacuee' | 'volunteer';
		title: string;
		description: string;
		path: typeof KIOSK_REPRINT_PATH | typeof KIOSK_VOLUNTEER_CARD_PATH;
		icon: Component;
		cardTone: string;
		iconTone: string;
	}

	const TARGETS: readonly PrintTarget[] = [
		{
			id: 'evacuee',
			title: 'ผู้พักพิง',
			description: 'ผู้ที่ลงทะเบียนเข้าพักในศูนย์',
			path: KIOSK_REPRINT_PATH,
			icon: Users,
			cardTone: 'border-sky-200 bg-sky-50',
			iconTone: 'bg-white text-sky-800'
		},
		{
			id: 'volunteer',
			title: 'จิตอาสา',
			description: 'พิมพ์บัตร QR จิตอาสาด้วยเบอร์โทร',
			path: KIOSK_VOLUNTEER_CARD_PATH,
			icon: HeartHandshake,
			cardTone: 'border-domain-volunteer-border bg-domain-volunteer-subtle',
			iconTone: 'bg-white text-domain-volunteer-text'
		}
	];

	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);
	const homeUrl = $derived(resolve(`/kiosk${contextQuery}`));

	onMount(() => {
		idleTimeout.start();
		return () => idleTimeout.stop();
	});

	function returnHome(): void {
		navigateToKioskHome(contextQuery);
	}

	function recordActivity(): void {
		idleTimeout.recordActivity();
	}
</script>

<svelte:head>
	<title>พิมพ์ QR — SmartShelter Kiosk</title>
</svelte:head>

<svelte:window onpointerdown={recordActivity} onkeydown={recordActivity} />

<section
	class="kiosk-method-page mx-auto flex w-full max-w-5xl flex-col gap-4 kiosk-portrait:gap-6"
	data-reprint=""
	aria-labelledby="print-qr-title"
>
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} />
	</div>

	<header class="text-center">
		<h1
			id="print-qr-title"
			class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl"
		>
			พิมพ์ QR
		</h1>
		<p class="mt-1 text-base font-medium text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
			เลือกประเภทผู้ที่ต้องการพิมพ์
		</p>
	</header>

	<div
		class="method-grid grid grid-cols-2 gap-3 sm:gap-4 kiosk-portrait:grid-cols-1 kiosk-portrait:gap-5"
		data-single-row=""
		style:--method-rows="1"
		style:--method-count={TARGETS.length}
		aria-label="ประเภทผู้ที่ต้องการพิมพ์ QR"
	>
		{#each TARGETS as target (target.id)}
			<a
				href={resolve(`${target.path}${contextQuery}`)}
				aria-label={`${target.title} · ${target.description}`}
				class={`method-card flex flex-col items-center justify-center gap-3 rounded-xl border p-3 text-center no-underline shadow-2xs transition-transform duration-150 ease-out hover:z-10 hover:scale-[1.02] focus-visible:z-10 focus-visible:scale-[1.02] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:focus-visible:scale-100 sm:p-4 kiosk-portrait:flex-row kiosk-portrait:justify-start kiosk-portrait:px-8 ${target.cardTone}`}
			>
				<div
					class="flex flex-col items-center justify-center gap-3 text-center kiosk-portrait:flex-1 kiosk-portrait:flex-row kiosk-portrait:justify-start kiosk-portrait:gap-6 kiosk-portrait:text-left"
				>
					<div
						class={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl kiosk-portrait:h-20 kiosk-portrait:w-20 ${target.iconTone}`}
						aria-hidden="true"
					>
						<target.icon class="h-6 w-6 kiosk-portrait:h-10 kiosk-portrait:w-10" />
					</div>
					<div class="min-w-0">
						<h2
							class="text-lg leading-snug font-bold text-slate-900 sm:text-xl kiosk-portrait:text-3xl"
						>
							{target.title}
						</h2>
						<p
							class="method-description mt-1 text-base leading-snug text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl"
						>
							{target.description}
						</p>
					</div>
				</div>
			</a>
		{/each}
	</div>
</section>

<!--
	Header, grid and cards mirror identity-method-selector.svelte (same classes, same sizing rules,
	copied below with the reprint-link variants dropped) so a card here is the size of a home
	method card on 1024x600, desktop landscape and 24" portrait. The back button stands in for the
	home stepper at the top. Keep the two <style> blocks in step.
-->
<style>
	.kiosk-method-page {
		min-height: calc(100svh - 8rem);
		justify-content: flex-start;
	}

	/* data-reprint: this page is only reachable when the home page shows its «พิมพ์ QR» row, so the
	   home cards are always the shorter, reprint-row variant. Those min-heights apply here too. */
	.kiosk-method-page[data-reprint] .method-card {
		min-height: clamp(9.5rem, calc((100svh - 25rem) / var(--method-rows, 2)), 30rem);
	}

	@media (max-width: 640px) {
		.method-grid[data-single-row] .method-card {
			padding: 0.5rem;
		}

		.method-grid[data-single-row] .method-description {
			display: none;
		}
	}

	/* 1024x600: back button stays on top; title + cards sit a little above the centre of the space
	   below it (the bottom padding lifts them by half its height). */
	@media (max-height: 650px) {
		.kiosk-method-page {
			min-height: auto;
			flex: 1;
			justify-content: flex-start;
			gap: 0.5rem;
			/* 3.5rem, not the home page's 2rem: no row below the cards here, so lift the group ~12px. */
			padding-bottom: 3.5rem;
		}

		.kiosk-method-page > header {
			margin-top: auto;
		}

		.method-grid {
			gap: 0.5rem;
			margin-bottom: auto;
		}

		.method-card {
			min-height: 9.5rem;
			padding: 0.75rem;
		}

		.kiosk-method-page[data-reprint] .method-grid[data-single-row] .method-card {
			min-height: 10.5rem;
		}
	}

	/* 24" portrait: stacked cards fill the middle/lower screen. */
	@media screen and (orientation: portrait) and (min-height: 1200px) {
		.kiosk-method-page {
			min-height: calc(100svh - 11rem);
		}

		.kiosk-method-page[data-reprint] .method-card {
			min-height: clamp(8rem, calc((100svh - 30rem) / var(--method-count, 3)), 15rem);
		}
	}
</style>

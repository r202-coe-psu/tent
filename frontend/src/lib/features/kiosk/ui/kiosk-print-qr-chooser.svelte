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
			cardTone: 'border-violet-200 bg-violet-50',
			iconTone: 'bg-white text-[#1E3A8A]'
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

<div
	class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 kiosk-portrait:gap-6 kiosk-compact:gap-1"
>
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} />
	</div>

	<section
		class="flex flex-1 flex-col gap-4 kiosk-portrait:gap-6 kiosk-compact:justify-center kiosk-compact:gap-3 kiosk-compact:pb-6"
		aria-labelledby="print-qr-title"
	>
		<header class="text-center">
			<h1
				id="print-qr-title"
				class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl kiosk-compact:text-xl"
			>
				พิมพ์ QR
			</h1>
			<p
				class="mt-1 text-base font-medium text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl kiosk-compact:mt-0 kiosk-compact:text-sm"
			>
				เลือกประเภทผู้ที่ต้องการพิมพ์
			</p>
		</header>

		<div
			class="grid flex-1 grid-cols-2 gap-3 sm:gap-4 kiosk-portrait:grid-cols-1 kiosk-portrait:gap-5 kiosk-compact:flex-none kiosk-compact:gap-3"
		>
			{#each TARGETS as target (target.id)}
				<a
					href={resolve(`${target.path}${contextQuery}`)}
					aria-label={`${target.title} · ${target.description}`}
					class={`flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border p-3 text-center no-underline shadow-2xs transition-transform duration-150 ease-out hover:z-10 hover:scale-[1.02] focus-visible:z-10 focus-visible:scale-[1.02] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:focus-visible:scale-100 sm:p-4 kiosk-portrait:min-h-48 kiosk-portrait:flex-row kiosk-portrait:justify-start kiosk-portrait:gap-6 kiosk-portrait:px-8 kiosk-portrait:text-left kiosk-compact:min-h-28 kiosk-compact:gap-2 kiosk-compact:p-2 ${target.cardTone}`}
				>
					<div
						class={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl kiosk-portrait:h-20 kiosk-portrait:w-20 kiosk-compact:h-10 kiosk-compact:w-10 ${target.iconTone}`}
						aria-hidden="true"
					>
						<target.icon class="h-6 w-6 kiosk-portrait:h-10 kiosk-portrait:w-10" />
					</div>
					<div class="min-w-0">
						<h2
							class="text-lg leading-snug font-bold text-slate-900 sm:text-xl kiosk-portrait:text-3xl kiosk-compact:text-lg"
						>
							{target.title}
						</h2>
						<p
							class="mt-1 text-base leading-snug text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl kiosk-compact:mt-0 kiosk-compact:text-sm"
						>
							{target.description}
						</p>
					</div>
				</a>
			{/each}
		</div>
	</section>
</div>

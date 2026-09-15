<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import { PORTAL_SESSION_KEY, PORTAL_TOKEN_HANDOFF_KEY } from '$lib/features/volunteer-portal';

	let { children }: { children: Snippet } = $props();

	function leavePortal() {
		try {
			sessionStorage.removeItem(PORTAL_SESSION_KEY);
			sessionStorage.removeItem(PORTAL_TOKEN_HANDOFF_KEY);
		} catch {
			// Storage unavailable.
		}
	}
</script>

<div class="flex min-h-svh flex-col bg-[#f5f7fa] text-foreground antialiased">
	<header class="sticky top-0 z-50 border-b border-[#092f58] bg-[#0a3b6e] text-white shadow-sm">
		<div
			class="mx-auto flex min-h-[76px] w-full max-w-[1440px] items-center justify-between gap-4 px-5 py-3 sm:px-8"
		>
			<a
				href={resolve('/')}
				onclick={leavePortal}
				class="flex min-w-0 items-center gap-3"
				aria-label="กลับหน้าหลัก"
			>
				<div
					class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white"
				>
					<HeartHandshake class="size-6" strokeWidth={1.8} />
				</div>
				<div class="min-w-0">
					<p class="truncate text-base font-extrabold tracking-tight sm:text-lg">
						ระบบบริการจิตอาสา
					</p>
					<p class="truncate text-[11px] font-medium text-blue-100 sm:text-xs">
						เช็คงาน ติดตามสถานะ และรายงานตัวปฏิบัติหน้าที่
					</p>
				</div>
			</a>

			<div class="flex shrink-0 items-center gap-2 sm:gap-3">
				<a
					href={resolve('/')}
					onclick={leavePortal}
					class="hidden items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20 sm:flex"
				>
					<ArrowLeft class="size-3.5" />
					กลับหน้าหลัก
				</a>
			</div>
		</div>
	</header>

	<main class="flex-1">
		<div class="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
			{@render children()}
		</div>
	</main>

	<footer
		class="border-t border-slate-200 bg-white px-6 py-5 text-center text-[11px] text-slate-500"
	>
		ระบบบริการจิตอาสา · Smart Shelter Project
	</footer>
</div>

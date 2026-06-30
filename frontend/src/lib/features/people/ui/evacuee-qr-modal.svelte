<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Printer from '@lucide/svelte/icons/printer';
	import type { Evacuee } from '$lib/features/people';
	import { maskNationalId } from '$lib/features/people';

	let {
		show,
		evacuee,
		onClose
	}: {
		show: boolean;
		evacuee: Evacuee;
		onClose: () => void;
	} = $props();
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-sm animate-in space-y-6 rounded-3xl border border-border bg-card p-6 text-center shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex justify-end">
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div
				id="qr-identity-card"
				class="mx-auto max-w-[280px] space-y-4 rounded-2xl border-2 border-slate-900 bg-white p-6 text-slate-900 shadow-md dark:border-slate-100"
			>
				<div class="border-b-2 border-slate-900 pb-2">
					<h4 class="text-xs font-bold tracking-widest text-slate-500 uppercase">
						Smart Shelter ID Card
					</h4>
					<h3 class="mt-0.5 text-base font-bold">บัตรประจำตัวผู้ประสบภัย</h3>
				</div>
				<div
					class="mx-auto flex h-40 w-40 flex-col items-center justify-center space-y-2 rounded-lg border border-slate-200 bg-slate-100 p-2"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="size-28"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect width="5" height="5" x="3" y="3" rx="1" />
						<rect width="5" height="5" x="16" y="3" rx="1" />
						<rect width="5" height="5" x="3" y="16" rx="1" />
						<path d="M21 16V21H16" />
						<path d="M21 16H16" />
						<path d="M9 3H13" />
						<path d="M21 9V13" />
						<path d="M9 21H13" />
						<path d="M3 9V13" />
					</svg>
					<span class="font-mono text-[9px] tracking-wider text-slate-500">
						ID: {evacuee._id.split(':')[1] || evacuee._id}
					</span>
				</div>
				<div class="space-y-1 text-center">
					<h3 class="text-base font-bold text-slate-900">
						{evacuee.first_name}
						{evacuee.last_name}
					</h3>
					<p class="font-mono text-[10px] text-slate-500">
						ID CARD: {maskNationalId(evacuee.person_id?.number)}
					</p>
					{#if evacuee.current_stay.zone}
						<div
							class="mt-1.5 inline-block rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase"
						>
							Zone: {evacuee.current_stay.zone.toUpperCase()}
						</div>
					{/if}
				</div>
			</div>

			<div class="flex justify-center gap-2 border-t border-border pt-4">
				<button
					onclick={() => window.print()}
					class="flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
				>
					<Printer class="size-4" />
					<span>สั่งพิมพ์บัตร</span>
				</button>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-muted dark:text-slate-200"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		#qr-identity-card,
		#qr-identity-card * {
			visibility: visible;
		}
		#qr-identity-card {
			position: absolute;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%) scale(1.5);
			border: 2px solid #000 !important;
			box-shadow: none !important;
			background-color: #fff !important;
			color: #000 !important;
		}
	}
</style>

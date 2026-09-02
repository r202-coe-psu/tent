<script lang="ts" module>
	export function buildScreeningDeepLink(evacueeId: string): string {
		return `/onsite/medical-screening/${evacueeId}`;
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import QRCode from 'qrcode';
	import Printer from '@lucide/svelte/icons/printer';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import Phone from '@lucide/svelte/icons/phone';
	import IdCard from '@lucide/svelte/icons/id-card';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import { Button } from '$lib/components/ui/button/index.js';
	import { previewElementAsPdf } from '$lib/utils/pdf';
	import { maskNationalId, EWAR_SYMPTOM_GROUPS, type Evacuee } from '$lib/features/people';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_HANDOVER_SLIP_I18N } from './_constants/evacuee-handover-slip.i18n';

	let {
		show = true,
		evacuee,
		symptoms = [],
		onClose,
		embedded = false
	}: {
		show?: boolean;
		evacuee: Evacuee;
		symptoms?: string[];
		onClose: () => void;
		embedded?: boolean;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_HANDOVER_SLIP_I18N, languageStore.current));

	let qrUrl = $state<string | null>(null);
	let cardEl = $state<HTMLDivElement | null>(null);
	let isExportingPdf = $state(false);

	const deepLink = $derived(buildScreeningDeepLink(evacuee._id));

	$effect(() => {
		if (!show) return;
		qrUrl = null;
		QRCode.toDataURL(deepLink, {
			width: 320,
			margin: 1,
			color: { dark: '#0f172a', light: '#ffffff' }
		})
			.then((url) => {
				qrUrl = url;
			})
			.catch((err) => {
				console.error('[EvacueeHandoverSlipModal] QR code generation error:', err);
			});
	});

	function getSymptomLabel(id: string): string {
		for (const group of EWAR_SYMPTOM_GROUPS) {
			const found = group.symptoms.find((s) => s.id === id);
			if (found) return found.label;
		}
		return id;
	}

	async function handlePrint() {
		if (typeof window === 'undefined') return;

		if (!cardEl) {
			window.print();
			return;
		}

		// Try previewElementAsPdf if available, fallback to window.print
		const previewWindow = window.open('', '_blank');
		if (!previewWindow) {
			window.print();
			return;
		}

		isExportingPdf = true;
		cardEl.classList.add('print-capture');
		try {
			await tick();
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			await previewElementAsPdf(cardEl, `handover-slip-${evacuee._id.replace(/:/g, '-')}`, {
				maxWidthMm: 105,
				previewWindow
			});
		} catch {
			previewWindow.close();
			// Fallback to standard browser print
			window.print();
		} finally {
			cardEl.classList.remove('print-capture');
			isExportingPdf = false;
		}
	}
</script>

{#if show}
	<div
		class={embedded
			? 'flex min-h-[70vh] items-center justify-center py-6'
			: 'fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/65 p-3 backdrop-blur-xs sm:p-6'}
		role="dialog"
		aria-modal="true"
		aria-label={t.title}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
		>
			<!-- Modal Header -->
			<div class="flex items-center justify-between border-b border-border px-5 py-3.5 sm:px-6">
				<div class="flex items-center gap-2.5">
					<div
						class="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"
					>
						<Stethoscope class="size-5" />
					</div>
					<div>
						<h2 class="text-base font-bold text-foreground sm:text-lg">{t.title}</h2>
						<p class="text-xs text-muted-foreground">{t.subtitle}</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label={t.close}
				>
					<X class="size-5" />
				</button>
			</div>

			<!-- Slip Body (Printable Area) -->
			<div class="flex-1 overflow-y-auto p-5 sm:p-6">
				<div
					bind:this={cardEl}
					class="space-y-5 rounded-xl border border-border/80 bg-background p-5 shadow-xs"
				>
					<!-- Slip Card Header -->
					<div class="flex items-start justify-between border-b border-border/60 pb-3">
						<div>
							<div class="flex items-center gap-2">
								<span
									class="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold tracking-wide text-primary"
								>
									STATION 1 $\rightarrow$ STATION 2
								</span>
								<span
									class="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
								>
									{t.statusArriving}
								</span>
							</div>
							<h3 class="mt-2 text-lg font-extrabold text-foreground">
								{evacuee.first_name}
								{evacuee.last_name}
								{#if evacuee.nickname}
									<span class="text-sm font-normal text-muted-foreground">({evacuee.nickname})</span
									>
								{/if}
							</h3>
						</div>
					</div>

					<!-- Evacuee Info Grid -->
					<div class="grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-2">
						<div class="space-y-1">
							<span class="flex items-center gap-1 text-2xs font-semibold text-muted-foreground">
								<IdCard class="size-3.5" />
								{t.idNumber}
							</span>
							<p class="font-mono font-medium text-foreground">
								{maskNationalId(evacuee.person_id?.number) || '—'}
							</p>
						</div>

						<div class="space-y-1">
							<span class="flex items-center gap-1 text-2xs font-semibold text-muted-foreground">
								<Phone class="size-3.5" />
								{t.phone}
							</span>
							<p class="font-medium text-foreground">
								{evacuee.phone || t.noPhone}
							</p>
						</div>
					</div>

					<!-- Special Needs Badges -->
					<div class="space-y-1.5 border-t border-border/60 pt-3">
						<span class="flex items-center gap-1 text-2xs font-bold text-foreground">
							<HeartPulse class="size-3.5 text-amber-600" />
							{t.specialNeeds}
						</span>
						{#if evacuee.special_needs && evacuee.special_needs.length > 0}
							<div class="flex flex-wrap gap-1.5 pt-0.5">
								{#each evacuee.special_needs as tag (tag)}
									<span
										class="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
									>
										{tag}
									</span>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-muted-foreground italic">{t.noSpecialNeeds}</p>
						{/if}
					</div>

					<!-- Flagged EWAR Symptoms Badges -->
					<div class="space-y-1.5 border-t border-border/60 pt-3">
						<span class="flex items-center gap-1 text-2xs font-bold text-foreground">
							<AlertCircle class="size-3.5 text-destructive" />
							{t.ewarSymptoms}
						</span>
						{#if symptoms.length > 0}
							<div class="flex flex-wrap gap-1.5 pt-0.5">
								{#each symptoms as sym (sym)}
									<span
										class="inline-flex items-center rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-900 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
									>
										{getSymptomLabel(sym)}
									</span>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-muted-foreground italic">{t.noSymptoms}</p>
						{/if}
					</div>

					<!-- QR Code Box -->
					<div
						class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-4 text-center"
					>
						{#if qrUrl}
							<img
								src={qrUrl}
								alt="Medical Screening QR Code"
								class="size-48 rounded-lg bg-white p-2 shadow-xs"
							/>
						{:else}
							<div
								class="flex size-48 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground"
							>
								กำลังสร้าง QR Code...
							</div>
						{/if}
						<p class="mt-2.5 text-xs font-semibold text-foreground">
							{t.scanInstruction}
						</p>
						<p class="mt-1 font-mono text-[10px] text-muted-foreground">
							{deepLink}
						</p>
					</div>
				</div>
			</div>

			<!-- Modal Footer Actions -->
			<div
				class="flex flex-col gap-2.5 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
			>
				<Button
					type="button"
					variant="outline"
					onclick={handlePrint}
					disabled={isExportingPdf}
					class="gap-2 text-sm font-semibold"
				>
					<Printer class="size-4" />
					{t.print}
				</Button>

				<Button
					type="button"
					onclick={onClose}
					class="gap-2 bg-primary text-sm font-bold text-primary-foreground hover:bg-primary/90"
				>
					<Check class="size-4" />
					{t.doneNext}
				</Button>
			</div>
		</div>
	</div>
{/if}

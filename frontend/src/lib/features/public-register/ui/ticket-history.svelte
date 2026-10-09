<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Calendar from '@lucide/svelte/icons/calendar';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Plus from '@lucide/svelte/icons/plus';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import BookingTicketView from './booking-ticket.svelte';
	import type { BookingTicket } from '../application/booking-store.svelte';
	import { getStoredTickets, removeStoredTicket } from '../data/ticket-storage';
	import { checkTicketStatus } from '../data/public-register.api';
	import { syncStoredTicketStatuses } from '../application/ticket-sync';
	import { langState } from '$lib/states/i18n.svelte';
	import { PUBLIC_TICKET_HISTORY_I18N } from '$lib/constants/i18n';
	import { getTranslation } from '$lib/utils/i18n';

	interface Props {
		onNewBooking?: () => void;
		onTicketsChange?: () => void;
	}

	const { onNewBooking, onTicketsChange }: Props = $props();

	const copy = $derived(getTranslation(PUBLIC_TICKET_HISTORY_I18N, langState.current));

	let tickets = $state<BookingTicket[]>([]);
	let selectedTicket = $state<BookingTicket | null>(null);
	let checkingCode = $state<string | null>(null);

	onMount(() => {
		tickets = getStoredTickets();
		void syncAllStatus();
	});

	async function syncAllStatus() {
		const { verified } = await syncStoredTicketStatuses();
		if (verified.length === 0) return;
		tickets = getStoredTickets();
		if (selectedTicket && !tickets.some((t) => t.code === selectedTicket?.code)) {
			selectedTicket = null;
		}
		onTicketsChange?.();
		toast.info(copy.ticketsClaimedToast);
	}

	function handleRemove(code: string, e?: MouseEvent) {
		e?.stopPropagation();
		if (confirm(copy.confirmRemove)) {
			removeStoredTicket(code);
			tickets = getStoredTickets();
			if (selectedTicket?.code === code) {
				selectedTicket = null;
			}
			onTicketsChange?.();
		}
	}

	function handleConfirmVerified(code: string, e?: MouseEvent) {
		e?.stopPropagation();
		if (confirm(copy.confirmVerified)) {
			removeStoredTicket(code);
			tickets = getStoredTickets();
			if (selectedTicket?.code === code) {
				selectedTicket = null;
			}
			onTicketsChange?.();
			toast.success(copy.verifiedToast);
		}
	}

	async function handleCheckStatus(code: string, e?: MouseEvent) {
		e?.stopPropagation();
		checkingCode = code;
		try {
			const res = await checkTicketStatus(code);
			if (res.verified) {
				removeStoredTicket(code);
				tickets = getStoredTickets();
				if (selectedTicket?.code === code) {
					selectedTicket = null;
				}
				onTicketsChange?.();
				toast.success(copy.statusVerified);
			} else if (res.notFound) {
				// Keep the ticket — the user can delete it manually; never auto-drop the only QR.
				toast.info(copy.statusNotFound);
			} else {
				toast.info(copy.statusPending);
			}
		} catch {
			toast.error(copy.statusCheckFailed);
		} finally {
			checkingCode = null;
		}
	}

	function formatDate(dateStr: string): string {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString(langState.current === 'th' ? 'th-TH' : 'en-US', {
					dateStyle: 'medium',
					timeStyle: 'short'
				});
	}
</script>

<div class="space-y-6">
	{#if selectedTicket}
		<div class="space-y-4">
			<button
				type="button"
				onclick={() => (selectedTicket = null)}
				class="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft class="size-4" />
				<span>{copy.backToList}</span>
			</button>

			<BookingTicketView
				ticket={selectedTicket}
				showSuccessHeader={false}
				onVerified={(code) => {
					/* Confirm lives in BookingTicketView; apply removal only */
					removeStoredTicket(code);
					tickets = getStoredTickets();
					selectedTicket = null;
					onTicketsChange?.();
					toast.success(copy.verifiedToast);
				}}
			/>
		</div>
	{:else if tickets.length === 0}
		<div class="flex flex-col gap-4">
			<h2 class="text-lg font-bold text-foreground">{copy.title}</h2>
			<div class="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
				>
					<QrCode class="size-6" />
				</div>
				<p class="text-sm font-bold text-foreground">{copy.emptyTitle}</p>
				<p class="mt-1 text-xs text-muted-foreground">
					{copy.emptyDesc}
				</p>
				{#if onNewBooking}
					<div class="mt-5">
						<Button onclick={onNewBooking} class="min-h-11 font-semibold">
							<Plus class="mr-1.5 size-4" />
							<span>{copy.startBooking}</span>
						</Button>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="space-y-4">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div class="min-w-0">
					<h2 class="text-lg font-bold text-foreground">{copy.title}</h2>
					<p class="text-xs text-muted-foreground">
						{copy.subtitle}
					</p>
				</div>
				{#if onNewBooking}
					<Button
						size="sm"
						onclick={onNewBooking}
						class="h-9 min-h-9 w-full gap-1.5 font-semibold sm:h-8 sm:min-h-0 sm:w-auto"
					>
						<Plus class="size-4" />
						<span>{copy.newBooking}</span>
					</Button>
				{/if}
			</div>
			<div class="grid gap-3">
				{#each tickets as t (t.code)}
					<div
						role="button"
						tabindex="0"
						onclick={() => (selectedTicket = t)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								selectedTicket = t;
							}
						}}
						class="flex cursor-pointer flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between"
					>
						<div class="min-w-0 flex-1 space-y-1.5">
							<div class="flex flex-wrap items-center gap-2">
								<span
									class="rounded-full {t.shelter_code === 'unassigned' ||
									t.type === 'unassigned_queue'
										? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
										: 'bg-primary/10 text-primary'} px-2 py-0.5 text-2xs font-bold"
								>
									{t.shelter_code === 'unassigned' || t.type === 'unassigned_queue'
										? copy.unassignedBadge
										: t.code}
								</span>
								<span class="text-sm font-bold text-foreground">
									{[t.first_name, t.last_name].filter(Boolean).join(' ') || copy.registrantFallback}
								</span>
							</div>

							<div
								class="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1"
							>
								<span class="flex min-w-0 items-center gap-1">
									<MapPin class="size-3.5 shrink-0" />
									<span class="truncate">
										{t.shelter_code === 'unassigned' || t.type === 'unassigned_queue'
											? copy.unassignedShelter
											: t.shelter_name || t.shelter_code}
									</span>
								</span>
								{#if t.booked_at}
									<span class="flex items-center gap-1">
										<Calendar class="size-3.5 shrink-0" />
										{formatDate(t.booked_at)}
									</span>
								{/if}
							</div>
						</div>

						<div
							class="flex items-center gap-1.5 border-t border-border/60 pt-3 sm:shrink-0 sm:gap-2 sm:border-0 sm:pt-0"
						>
							<Button
								type="button"
								variant="outline"
								size="sm"
								title={copy.checkStatusTitle}
								class="h-9 min-h-9 flex-1 gap-1 px-2 text-xs font-semibold sm:h-8 sm:min-h-0 sm:flex-none"
								disabled={checkingCode === t.code}
								onclick={(e) => handleCheckStatus(t.code, e)}
							>
								<RefreshCw class="size-3.5 {checkingCode === t.code ? 'animate-spin' : ''}" />
								<span class="hidden sm:inline">{copy.checkStatus}</span>
							</Button>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								title={copy.markVerifiedTitle}
								class="h-9 min-h-9 flex-1 gap-1 px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 sm:h-8 sm:min-h-0 sm:flex-none dark:text-emerald-300 dark:hover:bg-emerald-950/50"
								onclick={(e) => handleConfirmVerified(t.code, e)}
							>
								<CheckCircle class="size-3.5 text-emerald-600" />
								<span>{copy.markVerified}</span>
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={copy.removeAria}
								class="h-9 min-h-9 shrink-0 text-muted-foreground hover:text-destructive sm:h-8 sm:min-h-0"
								onclick={(e) => handleRemove(t.code, e)}
							>
								<Trash2 class="size-4" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

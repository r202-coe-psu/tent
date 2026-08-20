<script lang="ts">
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import UserRound from '@lucide/svelte/icons/user-round';
	import { getBookingStore, type BookingStep } from '../application/booking-store.svelte';

	const booking = getBookingStore();

	const steps = [
		{ id: 'shelter', icon: ClipboardCheck, label: 'เลือกศูนย์' },
		{ id: 'person', icon: UserRound, label: 'ข้อมูลผู้จอง' },
		{ id: 'ticket', icon: QrCode, label: 'ใบจอง' }
	] as const satisfies readonly { id: BookingStep; icon: unknown; label: string }[];

	const stepIndexMap: Record<BookingStep, number> = { shelter: 0, person: 1, ticket: 2 };
	const activeIndex = $derived(stepIndexMap[booking.activeStep] ?? 0);
	const progressWidth = $derived(`${(activeIndex / (steps.length - 1)) * 100}%`);
</script>

<div
	class="w-full overflow-hidden rounded-2xl border border-black/[0.04] bg-card p-4 shadow-sm sm:px-8"
>
	<div class="relative mx-auto flex w-full items-center justify-between">
		<div
			class="absolute top-5 right-6 left-6 h-1 -translate-y-1/2 sm:top-1/2 sm:right-10 sm:left-10"
		>
			<div class="absolute inset-0 rounded-full bg-muted"></div>
			<div
				class="absolute top-0 bottom-0 left-0 rounded-full bg-primary transition-all duration-500"
				style:width={progressWidth}
			></div>
		</div>

		{#each steps as step, idx (step.id)}
			{@const isActive = booking.activeStep === step.id}
			{@const isCompleted = activeIndex > idx}
			<button
				type="button"
				onclick={() => (booking.activeStep = step.id)}
				disabled={booking.reachedStep < idx + 1}
				class="relative z-10 flex flex-col items-center gap-2 rounded-xl p-1 transition-all sm:flex-row sm:bg-card sm:px-4 sm:py-2.5
					{isActive
					? 'sm:-translate-y-0.5 sm:shadow-md sm:ring-1 sm:ring-black/5'
					: 'cursor-pointer hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-30'}"
			>
				<div
					class="flex h-8 w-8 items-center justify-center rounded-full transition-colors sm:h-10 sm:w-10
					{isActive
						? 'bg-primary text-primary-foreground shadow-md'
						: isCompleted
							? 'bg-primary text-primary-foreground'
							: 'border-2 border-card bg-muted text-muted-foreground'}"
				>
					<step.icon class={isActive || isCompleted ? 'h-[18px] w-[18px]' : 'h-4 w-4'} />
				</div>
				<div class="mt-1 flex flex-col items-center sm:mt-0 sm:items-start">
					<span
						class="hidden text-[10px] font-bold tracking-widest uppercase sm:block
						{isActive || isCompleted ? 'text-primary' : 'text-muted-foreground'}"
					>
						STEP 0{idx + 1}
					</span>
					<span
						class="text-xs font-semibold whitespace-nowrap sm:text-sm
						{isActive
							? 'font-bold text-foreground'
							: isCompleted
								? 'text-foreground/80'
								: 'text-muted-foreground'}"
					>
						{step.label}
					</span>
				</div>
			</button>
		{/each}
	</div>
</div>

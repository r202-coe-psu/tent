<script lang="ts">
	import Phone from '@lucide/svelte/icons/phone';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { PublicShelterDetail } from '$lib/features/public-portal';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();
</script>

<section>
	<div class="mb-4 flex items-center gap-2">
		<Phone class="h-5 w-5 text-success-dark" />
		<h2 class="text-lg font-bold text-foreground">ติดต่อสอบถาม</h2>
	</div>

	<div
		class="mb-4 flex items-center gap-4 rounded-xl border border-success-border bg-success-muted p-5 shadow-sm"
	>
		<div
			class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success/20 text-success-dark"
		>
			<Phone class="h-6 w-6" />
		</div>
		<div>
			<div class="text-sm font-bold text-success-dark">
				ผู้ดูแลศูนย์: {shelter.contact?.manager === 'unspecified'
					? 'ไม่มีชื่อผู้ประสานงาน'
					: shelter.contact?.manager || '-'}
			</div>
			<div class="text-xl font-bold text-success-dark">
				{shelter.contact?.phone === 'unspecified'
					? 'ไม่มีข้อมูลติดต่อ'
					: shelter.contact?.phone || '-'}
			</div>
		</div>
	</div>

	{#if shelter.faq && shelter.faq.length > 0}
		<div class="flex flex-col gap-2">
			{#each shelter.faq as item (item.q)}
				<details class="group overflow-hidden rounded-xl border border-border bg-white shadow-sm">
					<summary
						class="flex cursor-pointer list-none items-start justify-between gap-4 p-4 text-sm font-bold text-foreground hover:bg-muted/50 [&::-webkit-details-marker]:hidden"
					>
						<div class="flex items-start gap-2">
							<span class="mt-0.5 text-primary">Q:</span>
							<span>{item.q}</span>
						</div>
						<ChevronDown
							class="h-5 w-5 shrink-0 text-muted-foreground/80 transition-transform group-open:rotate-180"
						/>
					</summary>
					<div
						class="flex items-start gap-2 border-t border-border/50 bg-muted/50 p-4 pt-2 text-sm text-muted-foreground"
					>
						<span class="font-bold text-success-dark">A:</span>
						<span>{item.a}</span>
					</div>
				</details>
			{/each}
		</div>
	{/if}
</section>

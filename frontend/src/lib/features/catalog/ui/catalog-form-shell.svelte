<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import X from '@lucide/svelte/icons/x';

	let {
		eyebrow = 'ฐานข้อมูลมาสเตอร์ส่วนกลาง (MASTER DATA ENGINE)',
		title,
		icon,
		canWrite,
		onclose,
		children
	}: {
		eyebrow?: string;
		title: string;
		icon?: Component<{ class?: string }>;
		canWrite: boolean;
		onclose: () => void;
		children: Snippet;
	} = $props();
</script>

<div class="w-full rounded-2xl border border-border bg-card p-6 shadow-2xs md:p-8">
	<div class="flex items-start justify-between gap-4">
		<div class="flex flex-col gap-1">
			<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
				{eyebrow}
			</p>
			<h1
				class="flex items-center gap-2 text-xl leading-tight font-bold text-foreground md:text-2xl"
			>
				{#if icon}
					{@const Icon = icon}
					<Icon class="size-5 text-[var(--brand-primary)]" />
				{/if}
				{title}
			</h1>
		</div>

		<button
			type="button"
			onclick={onclose}
			class="flex min-h-11 min-w-11 items-center justify-center rounded-lg transition hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			<X class="size-5 text-muted-foreground" />
			<span class="sr-only">ปิดฟอร์ม</span>
		</button>
	</div>
	<Separator class="my-4" />
	{#if canWrite}
		{@render children()}
	{:else}
		<div class="py-12 text-center text-sm font-bold text-destructive">
			คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (Unauthorized)
		</div>
	{/if}
</div>

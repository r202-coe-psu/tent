<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/shadcn.js';

	let {
		href,
		label = 'เข้าสู่ระบบด้วย ThaID',
		class: className,
		...rest
	}: {
		href: string;
		label?: string;
		class?: string;
	} & Omit<HTMLAnchorAttributes, 'href' | 'class'> = $props();
</script>

<a
	{href}
	{...rest}
	class={cn(
		'inline-flex h-13 w-full items-center justify-center gap-3 rounded-full',
		'border border-slate-300 bg-white px-5 text-base font-semibold text-slate-800',
		'shadow-xs transition-colors',
		'hover:border-slate-400 hover:bg-slate-50',
		'focus-visible:ring-2 focus-visible:ring-[#0A2647]/30 focus-visible:ring-offset-2 focus-visible:outline-none',
		'active:bg-slate-100',
		className
	)}
>
	<span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
		<!-- ThaID / DOPA Digital ID Icon -->
		<svg
			class="size-5 text-[#0A2647]"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<rect x="2" y="4" width="20" height="16" rx="3" fill="#1E3A8A" stroke="#1E3A8A" />
			<!-- Card Header & Badge -->
			<circle cx="7.5" cy="10" r="2.5" fill="#FFFFFF" stroke="none" />
			<path d="M4.5 16c0-1.8 1.5-3 3-3s3 1.2 3 3" stroke="#FFFFFF" stroke-width="1.5" fill="none" />
			<!-- Identity lines -->
			<line
				x1="13"
				y1="9"
				x2="19"
				y2="9"
				stroke="#93C5FD"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
			<line
				x1="13"
				y1="12"
				x2="18"
				y2="12"
				stroke="#93C5FD"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
			<line
				x1="13"
				y1="15"
				x2="16"
				y2="15"
				stroke="#93C5FD"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
		</svg>
	</span>
	<span>{label}</span>
</a>

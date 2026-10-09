<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		children: Snippet;
	}

	let { children, class: className, ...rest }: Props = $props();
</script>

<!-- "Please wait" with a spinner, the same size on every kiosk step that waits on something. -->
<div
	{...rest}
	class={[
		'inline-flex min-h-14 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-[#F8FAFC] px-5 text-lg font-semibold text-slate-800 kiosk-portrait:min-h-20 kiosk-portrait:gap-4 kiosk-portrait:px-7 kiosk-portrait:text-2xl kiosk-compact:min-h-11 kiosk-compact:text-base',
		className
	]}
	role="status"
	aria-live="polite"
>
	<span
		class="size-6 shrink-0 animate-spin rounded-full border-[3px] border-slate-300 border-t-[#0A2647] motion-reduce:animate-none kiosk-portrait:size-8"
		aria-hidden="true"
	></span>
	{@render children()}
</div>

<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		href: string;
		/** Accessible name only; the visible text is always "กลับ". */
		label?: string;
		onclick?: () => void;
	}

	let { href, label = 'กลับหน้าเริ่มต้น', onclick }: Props = $props();
</script>

<!--
	The one back button of every kiosk step: screens render this instead of their own copy, so the
	touch target cannot drift between steps. Portrait sizes follow the portrait layout plan
	(§4.3/§4.5: min-h-16 text-xl). The portrait icon needs the trailing `!` because Button forces
	any svg without "size-" in its class list to size-4 with higher specificity than a utility.
-->
<Button
	{href}
	{onclick}
	variant="ghost"
	aria-label={label}
	class="min-h-11 gap-2 px-3 text-base font-semibold text-[#0A2647] focus-visible:ring-2 focus-visible:ring-[#0A2647] kiosk-portrait:min-h-16 kiosk-portrait:px-5 kiosk-portrait:text-xl kiosk-portrait:[&_svg]:size-6!"
>
	<ArrowLeft aria-hidden="true" />กลับ
</Button>

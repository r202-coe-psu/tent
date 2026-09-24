<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		value?: string;
		maxLength?: number;
		disabled?: boolean;
		onsubmit?: () => void;
	}

	let { value = $bindable(''), maxLength = 10, disabled = false, onsubmit }: Props = $props();

	let lastTapAt = 0;
	const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

	function acceptTap(): boolean {
		const now = Date.now();
		if (now - lastTapAt < 80) return false;
		lastTapAt = now;
		return true;
	}

	function appendDigit(digit: string, fromTap = false): void {
		if (disabled || (fromTap && !acceptTap()) || value.length >= maxLength) return;
		value += digit;
	}

	function removeDigit(fromTap = false): void {
		if (disabled || (fromTap && !acceptTap())) return;
		value = value.slice(0, -1);
	}

	function clearValue(): void {
		if (disabled || !acceptTap()) return;
		value = '';
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (disabled || event.repeat) return;
		if (/^\d$/.test(event.key)) {
			event.preventDefault();
			appendDigit(event.key);
		} else if (event.key === 'Backspace') {
			event.preventDefault();
			removeDigit();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			onsubmit?.();
		}
	}
</script>

<div class="grid grid-cols-3 gap-1" role="group" aria-label="ปุ่มกดตัวเลข">
	{#each digits as digit (digit)}
		<Button
			type="button"
			variant="outline"
			aria-label={`ตัวเลข ${digit}`}
			disabled={disabled || value.length >= maxLength}
			onkeydown={handleKeydown}
			onclick={() => appendDigit(digit, true)}
			class="min-h-16 rounded-lg border-slate-300 bg-white text-3xl font-bold text-[#0A2647] tabular-nums focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
		>
			{digit}
		</Button>
	{/each}
	<Button
		type="button"
		variant="outline"
		aria-label="ล้างทั้งหมด"
		disabled={disabled || value.length === 0}
		onkeydown={handleKeydown}
		onclick={clearValue}
		class="min-h-16 rounded-lg border-slate-300 bg-slate-50 text-base font-bold text-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
	>
		ล้าง
	</Button>
	<Button
		type="button"
		variant="outline"
		aria-label="ตัวเลข 0"
		disabled={disabled || value.length >= maxLength}
		onkeydown={handleKeydown}
		onclick={() => appendDigit('0', true)}
		class="min-h-16 rounded-lg border-slate-300 bg-white text-3xl font-bold text-[#0A2647] tabular-nums focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
	>
		0
	</Button>
	<Button
		type="button"
		variant="outline"
		aria-label="ลบหนึ่งตัว"
		disabled={disabled || value.length === 0}
		onkeydown={handleKeydown}
		onclick={() => removeDigit(true)}
		class="min-h-16 rounded-lg border-slate-300 bg-slate-50 text-base font-bold text-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
	>
		ลบ
	</Button>
</div>

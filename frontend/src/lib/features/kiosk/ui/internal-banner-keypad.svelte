<script lang="ts">
	import Delete from '@lucide/svelte/icons/delete';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		/** Shown above the keypad, e.g. after a code was rejected. */
		error?: string | null;
		/** Called with the 6-digit code, as soon as the sixth digit is in or ตกลง is pressed. */
		onsubmit: (code: string) => void;
	}

	let { error = null, onsubmit }: Props = $props();

	const CODE_LENGTH = 6;
	const COLUMNS = 3;
	// Reading order of the 3x4 grid; the arrow keys move focus by index in this order.
	const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'delete', '0', 'submit'] as const;
	type Key = (typeof KEYS)[number];

	let code = $state('');

	function press(key: Key): void {
		if (key === 'delete') {
			code = code.slice(0, -1);
		} else if (key === 'submit') {
			if (code.length === CODE_LENGTH) onsubmit(code);
		} else if (code.length < CODE_LENGTH) {
			code += key;
			if (code.length === CODE_LENGTH) onsubmit(code);
		}
	}

	let pad = $state<HTMLElement | null>(null);

	/**
	 * TV remotes and USB keyboards: digits 0-9 type the code, Backspace deletes, and the arrow keys
	 * move focus (Enter then clicks the focused button).
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		) {
			return;
		}
		if (/^[0-9]$/.test(event.key)) {
			event.preventDefault();
			press(event.key as Key);
			return;
		}
		if (event.key === 'Backspace') {
			event.preventDefault();
			press('delete');
			return;
		}
		moveFocus(event);
	}

	function moveFocus(event: KeyboardEvent): void {
		const step: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -COLUMNS,
			ArrowDown: COLUMNS
		};
		const delta = step[event.key];
		if (delta === undefined) return;
		event.preventDefault();
		const buttons = [...(pad?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
		const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const sameRow = (a: number, b: number) => Math.floor(a / COLUMNS) === Math.floor(b / COLUMNS);
		const to = from + delta;
		if (from === -1) {
			// Focus was lost (e.g. a tap on the background): the first arrow press brings it back.
			buttons[0]?.focus();
			return;
		}
		if (to < 0 || to >= buttons.length) return;
		if (Math.abs(delta) === 1 && !sameRow(from, to)) return;
		buttons[to]?.focus();
	}

	const keyClass =
		'h-24 rounded-xl border-slate-300 bg-white text-4xl font-bold text-[#0A2647] tabular-nums focus-visible:ring-4 focus-visible:ring-[#0284C7] focus-visible:ring-offset-2';
	const actionClass =
		'h-24 rounded-xl border-slate-300 bg-slate-100 text-2xl font-bold text-slate-800 focus-visible:ring-4 focus-visible:ring-[#0284C7] focus-visible:ring-offset-2';
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#F8FAFC] p-8">
	<h1 class="text-3xl font-bold text-[#0A2647]">กรอกรหัสจอ 6 หลัก</h1>

	{#if error}
		<p
			role="alert"
			class="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-lg font-semibold text-red-900"
		>
			<TriangleAlert class="size-6 shrink-0" aria-hidden="true" />
			{error}
		</p>
	{/if}

	<div class="flex gap-3" role="status" aria-label="รหัสที่กรอก">
		{#each { length: CODE_LENGTH }, i (i)}
			<span
				class="flex h-20 w-16 items-center justify-center rounded-xl border border-slate-300 bg-white text-4xl font-bold text-slate-900 tabular-nums"
			>
				{code[i] ?? ''}
			</span>
		{/each}
	</div>

	<div
		class="grid w-full max-w-md grid-cols-3 gap-3"
		role="group"
		aria-label="ปุ่มกดตัวเลข"
		bind:this={pad}
	>
		{#each KEYS as key (key)}
			{#if key === 'delete'}
				<Button
					type="button"
					variant="outline"
					class={actionClass}
					aria-label="ลบหนึ่งตัว"
					onclick={() => press(key)}
				>
					<Delete class="size-7" aria-hidden="true" />
					ลบ
				</Button>
			{:else if key === 'submit'}
				<Button
					type="button"
					class="h-24 rounded-xl bg-[#0A2647] text-2xl font-bold text-white hover:bg-[#051930] focus-visible:ring-4 focus-visible:ring-[#0284C7] focus-visible:ring-offset-2"
					aria-disabled={code.length < CODE_LENGTH}
					onclick={() => press(key)}
				>
					ตกลง
				</Button>
			{:else}
				<!-- Focus must already be on a key at load: a TV remote has no pointer to click one first. -->
				<Button
					type="button"
					variant="outline"
					class={keyClass}
					aria-label={`ตัวเลข ${key}`}
					onclick={() => press(key)}
					autofocus={key === '1'}
				>
					{key}
				</Button>
			{/if}
		{/each}
	</div>
</div>

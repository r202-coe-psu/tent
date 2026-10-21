<script lang="ts">
	import Check from '@lucide/svelte/icons/check';

	let {
		provider = null,
		providerDisplay = '',
		current
	}: {
		/** The provider already used (link page); null lists both. */
		provider?: 'google' | 'thaid' | null;
		/** Email / name shown on the finished OAuth step. */
		providerDisplay?: string;
		/** Omit on `/login` (plain checklist); set on `/login/link` to show progress. */
		current?: 1 | 2 | 3 | 4;
	} = $props();

	const providerLabel = $derived(
		provider === 'google' ? 'Google' : provider === 'thaid' ? 'ThaiD' : 'Google หรือ ThaiD'
	);

	const steps = $derived([
		{
			n: 1,
			title: 'ผู้ดูแลระบบสร้างบัญชีให้',
			detail: 'คุณจะได้รับ Username และรหัสผ่านชั่วคราว หากยังไม่ได้รับ กรุณาติดต่อผู้ดูแลระบบก่อน'
		},
		{
			n: 2,
			title: `เข้าสู่ระบบด้วย ${providerLabel}`,
			detail: providerDisplay
		},
		{
			n: 3,
			title: 'กรอก Username และรหัสผ่านชั่วคราว',
			detail: 'เพื่อเชื่อมบัญชีเข้ากับระบบ (ใช้เบอร์โทรศัพท์แทน Username ได้)'
		},
		{ n: 4, title: 'ตั้งรหัสผ่านใหม่', detail: 'ระบบจะพาไปตั้งรหัสผ่านของคุณเอง' }
	]);

	function stateOf(n: number): 'done' | 'current' | 'todo' | 'plain' {
		if (current === undefined) return 'plain';
		if (n < current) return 'done';
		return n === current ? 'current' : 'todo';
	}
</script>

<section
	aria-label="ขั้นตอนการใช้งานครั้งแรก"
	class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left sm:p-4"
>
	{#if current === undefined}
		<p class="text-sm font-semibold text-slate-800">ใช้งานครั้งแรก?</p>
	{/if}
	<ol class={['flex flex-col gap-2.5', current === undefined && 'mt-2']}>
		{#each steps as step (step.n)}
			{@const status = stateOf(step.n)}
			<li class="flex items-start gap-2.5" aria-current={status === 'current' ? 'step' : undefined}>
				<span
					class={[
						'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular-nums',
						status === 'done' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
						status === 'current' && 'border-[#0A2647] bg-[#0A2647] text-white',
						status === 'todo' && 'border-slate-200 bg-white text-slate-400',
						status === 'plain' && 'border-slate-300 bg-white text-slate-700'
					]}
				>
					{#if status === 'done'}
						<Check class="size-3.5" aria-hidden="true" />
						<span class="sr-only">เสร็จแล้ว ขั้นที่ {step.n}</span>
					{:else}
						{step.n}
					{/if}
				</span>
				<div class="min-w-0">
					<p
						class={[
							'text-sm font-semibold',
							status === 'todo' && 'text-slate-400',
							status === 'current' && 'text-[#0A2647]',
							(status === 'done' || status === 'plain') && 'text-slate-800'
						]}
					>
						{step.title}
						{#if status === 'current'}
							<span class="ml-1 text-xs font-medium text-slate-500">(ขั้นตอนนี้)</span>
						{/if}
					</p>
					{#if step.detail}
						<p
							class={[
								'text-xs break-words',
								status === 'todo' ? 'text-slate-400' : 'text-slate-500'
							]}
						>
							{step.detail}
						</p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
	<p class="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-500">
		ครั้งต่อไปกดปุ่มเข้าสู่ระบบด้วย {providerLabel} ได้เลย
	</p>
</section>

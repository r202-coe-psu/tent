<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';

	const SIZE = 21;
	const FINDER_ORIGINS = [
		[0, 0],
		[SIZE - 7, 0],
		[0, SIZE - 7]
	] as const;

	function inFinderZone(x: number, y: number): boolean {
		return FINDER_ORIGINS.some(
			([fx, fy]) => x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7
		);
	}

	// Fixed pseudo-random fill so the picture is stable between renders (SSR, tests, hydration).
	function buildDataModules(): { x: number; y: number }[] {
		const modules: { x: number; y: number }[] = [];
		let seed = 7;
		for (let y = 0; y < SIZE; y += 1) {
			for (let x = 0; x < SIZE; x += 1) {
				seed = (seed * 1103515245 + 12345) % 2147483648;
				if (!inFinderZone(x, y) && seed % 100 < 48) modules.push({ x, y });
			}
		}
		return modules;
	}

	const dataModules = buildDataModules();
</script>

<!--
	Decorative loop of a QR code being read by the reader built into the kiosk: a QR drawn inside a
	scanner viewfinder, a scan line sweeping across it, and an arrow pointing down at the reader below
	the screen. The text next to it carries the instruction, so the scene is hidden from assistive
	tech. Everything scales from --w (QR width).
-->
<div class="qr-scene [--w:8.5rem] kiosk-portrait:[--w:16rem]" aria-hidden="true">
	<div class="viewfinder">
		<span class="corner tl"></span>
		<span class="corner tr"></span>
		<span class="corner bl"></span>
		<span class="corner br"></span>

		<div class="qr-card">
			<svg viewBox="-1 -1 {SIZE + 2} {SIZE + 2}" class="qr" shape-rendering="crispEdges">
				{#each FINDER_ORIGINS as [fx, fy] (`${fx}-${fy}`)}
					<rect x={fx} y={fy} width="7" height="7" fill="#0a2647" />
					<rect x={fx + 1} y={fy + 1} width="5" height="5" fill="#ffffff" />
					<rect x={fx + 2} y={fy + 2} width="3" height="3" fill="#0a2647" />
				{/each}
				{#each dataModules as m (`${m.x}-${m.y}`)}
					<rect x={m.x} y={m.y} width="1" height="1" fill="#0a2647" />
				{/each}
			</svg>
			<span class="beam"></span>
		</div>
	</div>

	<span class="arrow"><ArrowDown class="size-full" strokeWidth={2.75} /></span>
	<span class="reader-bar"></span>
</div>

<style>
	.qr-scene {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: calc(var(--w) * 1.5);
		max-width: 100%;
	}

	.viewfinder {
		position: relative;
		width: calc(var(--w) * 1.22);
		height: calc(var(--w) * 1.22);
		padding: calc(var(--w) * 0.11);
	}

	.corner {
		position: absolute;
		width: calc(var(--w) * 0.2);
		height: calc(var(--w) * 0.2);
		border: 0 solid #0284c7;
	}

	.tl {
		top: 0;
		left: 0;
		border-top-width: calc(var(--w) * 0.032);
		border-left-width: calc(var(--w) * 0.032);
		border-top-left-radius: calc(var(--w) * 0.06);
	}

	.tr {
		top: 0;
		right: 0;
		border-top-width: calc(var(--w) * 0.032);
		border-right-width: calc(var(--w) * 0.032);
		border-top-right-radius: calc(var(--w) * 0.06);
	}

	.bl {
		bottom: 0;
		left: 0;
		border-bottom-width: calc(var(--w) * 0.032);
		border-left-width: calc(var(--w) * 0.032);
		border-bottom-left-radius: calc(var(--w) * 0.06);
	}

	.br {
		right: 0;
		bottom: 0;
		border-right-width: calc(var(--w) * 0.032);
		border-bottom-width: calc(var(--w) * 0.032);
		border-bottom-right-radius: calc(var(--w) * 0.06);
	}

	.qr-card {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		border: 0.0625rem solid rgb(10 38 71 / 0.18);
		border-radius: calc(var(--w) * 0.05);
		background: #ffffff;
	}

	.qr {
		display: block;
		width: 100%;
		height: 100%;
	}

	.beam {
		position: absolute;
		right: 0;
		left: 0;
		height: calc(var(--w) * 0.22);
		background: linear-gradient(
			to bottom,
			rgb(2 132 199 / 0) 0%,
			rgb(2 132 199 / 0.22) 85%,
			rgb(2 132 199 / 0.9) 100%
		);
		border-bottom: calc(var(--w) * 0.018) solid #0284c7;
		animation: sweep 2.6s ease-in-out infinite;
	}

	.arrow {
		width: calc(var(--w) * 0.2);
		height: calc(var(--w) * 0.2);
		margin-top: calc(var(--w) * 0.04);
		color: #0a2647;
		animation: nudge 1s ease-in-out infinite;
	}

	/* Stands in for the kiosk's real reader window just below the screen edge. */
	.reader-bar {
		width: calc(var(--w) * 1.05);
		height: calc(var(--w) * 0.045);
		margin-top: calc(var(--w) * 0.02);
		border-radius: 999px;
		background: #0a2647;
	}

	@keyframes sweep {
		0% {
			top: calc(var(--w) * -0.22);
		}
		100% {
			top: 100%;
		}
	}

	@keyframes nudge {
		50% {
			transform: translateY(calc(var(--w) * 0.05));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.beam {
			top: 45%;
			animation: none;
		}

		.arrow {
			animation: none;
		}
	}
</style>

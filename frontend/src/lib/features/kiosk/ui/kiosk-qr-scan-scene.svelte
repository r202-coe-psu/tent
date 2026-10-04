<script lang="ts">
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
	Decorative loop of a QR code being read by the reader built into the kiosk: a frameless QR, a scan line sweeping across it. The text next to it carries the instruction, so the scene is hidden from assistive
	tech. Everything scales from --w (QR width).
-->
<div class="qr-scene [--w:9rem] kiosk-portrait:[--w:17rem]" aria-hidden="true">
	<div class="viewfinder">
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
</div>

<style>
	.qr-scene {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: calc(var(--w) * 2);
		max-width: 100%;
	}

	.viewfinder {
		position: relative;
		width: var(--w);
		height: var(--w);
	}

	.qr-card {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		overflow: hidden;
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
		height: calc(var(--w) * 0.16);
		background: linear-gradient(
			to bottom,
			rgb(2 132 199 / 0) 0%,
			rgb(2 132 199 / 0.22) 85%,
			rgb(2 132 199 / 0.9) 100%
		);
		border-bottom: calc(var(--w) * 0.018) solid #0284c7;
		animation: sweep 2.6s ease-in-out infinite;
	}

	@keyframes sweep {
		0% {
			top: calc(var(--w) * -0.16);
		}
		100% {
			top: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.beam {
			top: 45%;
			animation: none;
		}
	}
</style>

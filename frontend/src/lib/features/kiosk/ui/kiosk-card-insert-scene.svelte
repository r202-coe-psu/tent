<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
</script>

<!--
	Decorative loop of an ID card sliding into the reader slot, drawn like the kiosk's real slot: a
	card lying out of a horizontal slit, tilted toward the user. The text above it carries the
	instruction, so the scene is hidden from assistive tech. Everything scales from --w (card width).
-->
<div class="insert-scene [--w:13.9rem] kiosk-portrait:[--w:27rem]" aria-hidden="true">
	<span class="slot"></span>
	<div class="clip">
		<div class="mover">
			<span class="arrow"><ArrowUp class="size-full" strokeWidth={2.5} /></span>
			<div class="tilt">
				<div class="card">
					<span class="code code-left"></span>
					<span class="code code-right"></span>
					<span class="chip">
						<span class="line h1"></span>
						<span class="line h2"></span>
						<span class="line v"></span>
					</span>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.insert-scene {
		position: relative;
		width: calc(var(--w) * 1.8);
		max-width: 100%;
		height: calc(var(--w) * 0.98);
	}

	.slot {
		position: absolute;
		top: calc(var(--w) * 0.031);
		left: 50%;
		width: calc(var(--w) * 0.97);
		height: calc(var(--w) * 0.026);
		margin-left: calc(var(--w) * -0.485);
		border-radius: 999px;
		background: #0a2647;
	}

	/* Starts at the slot's centre line, so whatever rises past it is "inside" the kiosk. */
	.clip {
		position: absolute;
		inset: calc(var(--w) * 0.044) 0 0 0;
		overflow: hidden;
	}

	.mover {
		position: absolute;
		top: 0;
		left: 50%;
		width: calc(var(--w) * 0.88);
		height: calc(var(--w) * 0.63);
		margin-left: calc(var(--w) * -0.44);
		animation: insert 5s ease infinite;
	}

	.arrow {
		position: absolute;
		top: calc(var(--w) * -0.152);
		left: calc(50% - var(--w) * 0.052);
		width: calc(var(--w) * 0.104);
		height: calc(var(--w) * 0.104);
		color: #0a2647;
		animation: nudge 1s ease-in-out infinite;
	}

	.tilt {
		position: absolute;
		inset: 0;
		transform: perspective(calc(var(--w) * 1.85)) rotateX(40deg);
		transform-origin: 50% 0;
	}

	.card {
		position: absolute;
		inset: 0;
		overflow: hidden;
		border: 0.09rem solid rgb(10 38 71 / 0.22);
		border-radius: calc(var(--w) * 0.03);
		background: linear-gradient(98deg, #c0e0f5 52%, #d6e8f5 60%);
	}

	.chip {
		position: absolute;
		top: 56%;
		left: 22%;
		width: calc(var(--w) * 0.18);
		height: 23%;
		border: 0.1rem solid #8f7230;
		border-radius: calc(var(--w) * 0.022);
		background: #c9a24d;
	}

	/* Positions and sizes are fractions of the real card's face, measured from a photo of it. */
	.code {
		position: absolute;
		width: 2.4%;
		border-radius: 999px;
		background: #475569;
	}

	.code-left {
		top: 38%;
		left: 8%;
		height: 50%;
		opacity: 0.75;
	}

	.code-right {
		top: 3%;
		left: 64%;
		height: 32%;
		opacity: 0.55;
	}

	.line {
		position: absolute;
		background: #8f7230;
		opacity: 0.65;
	}

	.line.h1,
	.line.h2 {
		right: 11%;
		left: 11%;
		height: 0.1rem;
	}

	.line.h1 {
		top: 33%;
	}

	.line.h2 {
		top: 66%;
	}

	.line.v {
		top: 14%;
		bottom: 14%;
		left: 50%;
		width: 0.1rem;
	}

	@keyframes insert {
		0% {
			transform: translateY(calc(var(--w) * 0.3));
			opacity: 0;
		}
		8% {
			transform: translateY(calc(var(--w) * 0.3));
			opacity: 1;
		}
		20% {
			transform: translateY(calc(var(--w) * 0.3));
			opacity: 1;
			animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
		}
		55%,
		85% {
			transform: translateY(calc(var(--w) * -0.093));
			opacity: 1;
		}
		93% {
			transform: translateY(calc(var(--w) * -0.093));
			opacity: 0;
		}
		100% {
			transform: translateY(calc(var(--w) * 0.3));
			opacity: 0;
		}
	}

	@keyframes nudge {
		50% {
			transform: translateY(calc(var(--w) * -0.02));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mover,
		.arrow {
			animation: none;
		}
	}
</style>

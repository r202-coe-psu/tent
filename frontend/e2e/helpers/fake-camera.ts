/**
 * Fake camera for scanner tests — a QR code as a `.y4m` video Chromium plays through
 * `--use-file-for-fake-video-capture`, so the real in-page scanner (html5-qrcode) decodes
 * it exactly as it would a phone camera. Written in plain Node (no ffmpeg needed).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';

const WIDTH = 640;
const HEIGHT = 480;
const FRAMES = 30;

/** Write a still QR of `text` as a y4m video and return its path. */
export function writeQrVideo(text: string, name: string): string {
	const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
	const size = qr.modules.size;
	const quiet = 4;
	const scale = Math.floor((Math.min(WIDTH, HEIGHT) * 0.8) / (size + quiet * 2));
	const ox = Math.floor((WIDTH - (size + quiet * 2) * scale) / 2);
	const oy = Math.floor((HEIGHT - (size + quiet * 2) * scale) / 2);

	// Luma: white page, black modules. Chroma: neutral grey.
	const luma = Buffer.alloc(WIDTH * HEIGHT, 235);
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			if (!qr.modules.get(row, col)) continue;
			for (let y = 0; y < scale; y++) {
				const start = (oy + (row + quiet) * scale + y) * WIDTH + ox + (col + quiet) * scale;
				luma.fill(16, start, start + scale);
			}
		}
	}
	const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), 128);

	const frames: Buffer[] = [Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F10:1 Ip A1:1 C420jpeg\n`)];
	for (let i = 0; i < FRAMES; i++) frames.push(Buffer.from('FRAME\n'), luma, chroma, chroma);

	const dir = join(tmpdir(), 'tent-e2e-fake-camera');
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${name}.y4m`);
	writeFileSync(path, Buffer.concat(frames));
	return path;
}

/** Chromium launch args that feed `videoPath` to every camera request, without a prompt. */
export function fakeCameraArgs(videoPath: string): string[] {
	return [
		'--use-fake-ui-for-media-stream',
		'--use-fake-device-for-media-stream',
		`--use-file-for-fake-video-capture=${videoPath}`
	];
}

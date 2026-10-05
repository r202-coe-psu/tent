import { selectCameraId } from '../domain/kiosk-camera';
import type { FaceCamera } from './face-check-session.svelte';

/** Preview frames stay small (the scanner client only judges framing); the verdict gets more pixels. */
export const FACE_PREVIEW_MAX_WIDTH = 640;
export const FACE_BURST_MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.88;

/** Largest size within `maxWidth` that keeps the video's aspect ratio; never enlarges. */
export function scaledFrameSize(
	width: number,
	height: number,
	maxWidth: number
): { width: number; height: number } {
	if (width <= 0 || height <= 0) return { width: 0, height: 0 };
	if (width <= maxWidth) return { width, height };
	return { width: maxWidth, height: Math.round((height * maxWidth) / width) };
}

async function pickDeviceId(
	devices: MediaDevices,
	cameraLabel: string | null
): Promise<string | null> {
	if (!cameraLabel) return null;
	// Device labels stay empty until a camera permission has been granted once.
	const probe = await devices.getUserMedia({ video: true });
	probe.getTracks().forEach((track) => track.stop());
	const cameras = (await devices.enumerateDevices())
		.filter((device) => device.kind === 'videoinput')
		.map((device) => ({ id: device.deviceId, label: device.label }));
	return selectCameraId(cameras, cameraLabel);
}

function frameToBlob(video: HTMLVideoElement, maxWidth: number): Promise<Blob> {
	const size = scaledFrameSize(video.videoWidth, video.videoHeight, maxWidth);
	if (size.width === 0) return Promise.reject(new Error('camera has no picture yet'));
	const canvas = document.createElement('canvas');
	canvas.width = size.width;
	canvas.height = size.height;
	canvas.getContext('2d')?.drawImage(video, 0, 0, size.width, size.height);
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('could not encode a frame'))),
			'image/jpeg',
			JPEG_QUALITY
		);
	});
}

/**
 * Starts the kiosk's face camera into `video`. `cameraLabel` picks one of several cameras (the
 * kiosk3 has JSK-RGB and JSK-IR behind one name); without it the front camera is used. Browser
 * errors (NotAllowedError, NotFoundError, ...) are passed on untouched for `classifyFaceFailure`.
 */
export async function openFaceCamera(
	video: HTMLVideoElement,
	cameraLabel: string | null,
	devices: MediaDevices = navigator.mediaDevices
): Promise<FaceCamera> {
	const deviceId = await pickDeviceId(devices, cameraLabel);
	const stream = await devices.getUserMedia({
		audio: false,
		video: {
			width: { ideal: 1280 },
			height: { ideal: 720 },
			...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' })
		}
	});
	video.srcObject = stream;
	try {
		await video.play();
	} catch (error) {
		// Do not leave the camera lit; the original error goes on so the caller can tell why.
		stream.getTracks().forEach((track) => track.stop());
		video.srcObject = null;
		throw error;
	}

	return {
		preview: () => frameToBlob(video, FACE_PREVIEW_MAX_WIDTH),
		async burst(count, intervalMs) {
			const frames: Blob[] = [];
			for (let index = 0; index < count; index += 1) {
				frames.push(await frameToBlob(video, FACE_BURST_MAX_WIDTH));
				if (index < count - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
			}
			return frames;
		},
		stop() {
			stream.getTracks().forEach((track) => track.stop());
			video.srcObject = null;
		}
	};
}

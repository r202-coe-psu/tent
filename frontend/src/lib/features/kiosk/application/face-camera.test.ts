import { describe, expect, it, vi } from 'vitest';
import { classifyFaceFailure } from '../domain/face-check';
import { openFaceCamera, scaledFrameSize } from './face-camera';

function fakeStream() {
	const track = { stop: vi.fn() };
	return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function fakeVideo(play: () => Promise<void> = async () => {}) {
	return { srcObject: null, play: vi.fn(play) } as unknown as HTMLVideoElement;
}

describe('scaledFrameSize', () => {
	it('keeps the aspect ratio, never enlarges, and gives nothing for an empty picture', () => {
		expect(scaledFrameSize(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
		expect(scaledFrameSize(320, 240, 640)).toEqual({ width: 320, height: 240 });
		expect(scaledFrameSize(0, 0, 640)).toEqual({ width: 0, height: 0 });
	});
});

describe('openFaceCamera failures', () => {
	it.each([
		['NotAllowedError', 'camera_denied'],
		['NotFoundError', 'camera_not_found'],
		['NotReadableError', 'camera_failed']
	] as const)('lets a %s from getUserMedia through unchanged', async (name, reason) => {
		const error = new DOMException('refused', name);
		const devices = { getUserMedia: vi.fn().mockRejectedValue(error) } as unknown as MediaDevices;

		const failure = await openFaceCamera(fakeVideo(), null, devices).catch((caught) => caught);

		expect(failure).toBe(error);
		expect(classifyFaceFailure(failure)).toBe(reason);
	});

	it('lets a refusal while probing for the labelled camera through unchanged', async () => {
		const error = new DOMException('refused', 'NotAllowedError');
		const devices = { getUserMedia: vi.fn().mockRejectedValue(error) } as unknown as MediaDevices;

		await expect(openFaceCamera(fakeVideo(), 'JSK-RGB', devices)).rejects.toBe(error);
	});

	it('turns the camera off again when the picture cannot start, and passes the error on', async () => {
		const { stream, track } = fakeStream();
		const devices = { getUserMedia: vi.fn().mockResolvedValue(stream) } as unknown as MediaDevices;
		const error = new DOMException('blocked', 'NotAllowedError');
		const video = fakeVideo(() => Promise.reject(error));

		await expect(openFaceCamera(video, null, devices)).rejects.toBe(error);

		expect(track.stop).toHaveBeenCalledOnce();
		expect(video.srcObject).toBeNull();
	});

	it('stops the stream and detaches the video when the session stops it', async () => {
		const { stream, track } = fakeStream();
		const devices = { getUserMedia: vi.fn().mockResolvedValue(stream) } as unknown as MediaDevices;
		const video = fakeVideo();

		const camera = await openFaceCamera(video, null, devices);
		expect(video.srcObject).toBe(stream);
		camera.stop();

		expect(track.stop).toHaveBeenCalledOnce();
		expect(video.srcObject).toBeNull();
	});
});

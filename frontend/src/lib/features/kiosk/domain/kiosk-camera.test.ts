import { describe, expect, it } from 'vitest';
import { selectCameraId } from './kiosk-camera';

const cameras = [
	{ id: 'a', label: 'JSK-IR (0c45:6366)' },
	{ id: 'b', label: 'JSK-RGB (0c45:6366)' }
];

describe('selectCameraId', () => {
	it('picks the first camera whose label contains the text, ignoring case', () => {
		expect(selectCameraId(cameras, 'jsk-rgb')).toBe('b');
		expect(selectCameraId(cameras, 'JSK')).toBe('a');
	});

	it('returns null when nothing matches or no label is configured', () => {
		expect(selectCameraId(cameras, 'webcam')).toBeNull();
		expect(selectCameraId(cameras, null)).toBeNull();
		expect(selectCameraId(cameras, '  ')).toBeNull();
		expect(selectCameraId([], 'JSK')).toBeNull();
	});
});

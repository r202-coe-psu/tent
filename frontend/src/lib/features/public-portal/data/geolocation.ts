export type GeoPosition = { lat: string; lng: string };

export type GeoUnavailableReason = 'unsupported' | 'insecure' | 'policy' | 'denied' | 'unavailable';

type PolicyDocument = Document & {
	permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
	featurePolicy?: { allowsFeature: (feature: string) => boolean };
};

export class GeolocationUnavailableError extends Error {
	readonly reason: GeoUnavailableReason;

	constructor(reason: GeoUnavailableReason) {
		super(`geolocation unavailable: ${reason}`);
		this.name = 'GeolocationUnavailableError';
		this.reason = reason;
	}
}

function policyAllowsGeolocation(): boolean {
	if (typeof document === 'undefined') return false;
	const policy =
		(document as PolicyDocument).permissionsPolicy ?? (document as PolicyDocument).featurePolicy;
	if (!policy?.allowsFeature) return true;
	return policy.allowsFeature('geolocation');
}

/** True when calling `getCurrentPosition` will not trip a Permissions-Policy violation. */
export function canRequestGeolocation(): boolean {
	if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return false;
	if (typeof window !== 'undefined' && !window.isSecureContext) return false;
	return policyAllowsGeolocation();
}

export function geolocationBlockReason(): GeoUnavailableReason | null {
	if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return 'unsupported';
	if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
	if (!policyAllowsGeolocation()) return 'policy';
	return null;
}

function reasonFromPositionError(err: GeolocationPositionError): GeoUnavailableReason {
	if (err.code === err.PERMISSION_DENIED) return 'denied';
	return 'unavailable';
}

export function requestUserPosition(
	options: PositionOptions = { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 }
): Promise<GeoPosition> {
	const blocked = geolocationBlockReason();
	if (blocked) return Promise.reject(new GeolocationUnavailableError(blocked));

	return new Promise((resolve, reject) => {
		navigator.geolocation.getCurrentPosition(
			(position) => {
				resolve({
					lat: position.coords.latitude.toString(),
					lng: position.coords.longitude.toString()
				});
			},
			(err) => reject(new GeolocationUnavailableError(reasonFromPositionError(err))),
			options
		);
	});
}

import type { SopRatioProfile } from '../domain/sop-ratio';

export interface SopRatioRepository {
	getActiveProfile(): Promise<SopRatioProfile | null>;
	listProfiles(): Promise<SopRatioProfile[]>;
}

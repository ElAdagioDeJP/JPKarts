// Authored tracks (docs/GDD.md §6). Each one is a JSON file in core/data/tracks/.
import playaCoco from '../../data/tracks/playa-coco.json';
import type { AuthoredTrackDef } from '../track/authoredTypes';
import { TRACK_DEFS, type TrackDef } from './tracks';

export const AUTHORED: AuthoredTrackDef[] = [playaCoco as unknown as AuthoredTrackDef];

/** Every playable track: the 16 legacy procedural tracks ("Clásicas") followed by the authored ones. */
export const ALL_TRACKS: (TrackDef | AuthoredTrackDef)[] = [...TRACK_DEFS, ...AUTHORED];
export const trackIndexById = (id: string) => ALL_TRACKS.findIndex((t) => t.id === id);

// Authored tracks (docs/GDD.md §6). Each one is a JSON file in core/data/tracks/.
import playaCoco from '../../data/tracks/playa-coco.json';
import praderaJp from '../../data/tracks/pradera-jp.json';
import tenisJp from '../../data/tracks/tenis-jp.json';
import bosqueEncantado from '../../data/tracks/bosque-encantado.json';
import valleMolino from '../../data/tracks/valle-molino.json';
import dunasDoradas from '../../data/tracks/dunas-doradas.json';
import bahiaAtardecer from '../../data/tracks/bahia-atardecer.json';
import glaciarPolar from '../../data/tracks/glaciar-polar.json';
import ciudadNeon from '../../data/tracks/ciudad-neon.json';
import selvaTropical from '../../data/tracks/selva-tropical.json';
import picoNevado from '../../data/tracks/pico-nevado.json';
import estadioCentral from '../../data/tracks/estadio-central.json';
import canonRojo from '../../data/tracks/canon-rojo.json';
import autopistaLaser from '../../data/tracks/autopista-laser.json';
import volcanRugiente from '../../data/tracks/volcan-rugiente.json';
import craterArdiente from '../../data/tracks/crater-ardiente.json';
import type { AuthoredTrackDef } from '../track/authoredTypes';
import { TRACK_DEFS, type TrackDef } from './tracks';

export const AUTHORED: AuthoredTrackDef[] = [
  playaCoco, praderaJp, tenisJp, bosqueEncantado, valleMolino, dunasDoradas, bahiaAtardecer, glaciarPolar, ciudadNeon, selvaTropical, picoNevado, estadioCentral, canonRojo, autopistaLaser, volcanRugiente, craterArdiente,
] as unknown as AuthoredTrackDef[];

/** Every playable track: the 16 legacy procedural tracks ("Clásicas") followed by the authored ones. */
export const ALL_TRACKS: (TrackDef | AuthoredTrackDef)[] = [...TRACK_DEFS, ...AUTHORED];
export const trackIndexById = (id: string) => ALL_TRACKS.findIndex((t) => t.id === id);

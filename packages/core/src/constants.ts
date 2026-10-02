/** Simulation constants shared by core and client (legacy values). */
export const TS = 2048; // world size (units)
export const HM = 512; // heightmap resolution (4 units per cell)
export const LAPS = 3;
export const ROAD = 42; // road half width
export const BW = 24; // shortcut half width
export const KSIZE = 12; // kart size for collisions
export const TRACK_LEN = 6100;
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

import type { LatLon } from "./types";

export const KBOS: LatLon = [42.3656, -71.0096];

export const M_TO_FT = 3.28084;
export const MS_TO_KT = 1.943844;
export const MS_TO_FPM = 196.8504;

const EARTH_RADIUS_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, degrees true (0-360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest angle between two headings, 0-180. */
export function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** Dead reckoning: move along a track at constant speed (flat-earth is fine for seconds). */
export function project(from: LatLon, trackDeg: number, speedKt: number, seconds: number): LatLon {
  const distNm = (speedKt * seconds) / 3600;
  const dLat = (distNm * Math.cos(rad(trackDeg))) / 60;
  const dLon = (distNm * Math.sin(rad(trackDeg))) / (60 * Math.cos(rad(from[0])));
  return [from[0] + dLat, from[1] + dLon];
}

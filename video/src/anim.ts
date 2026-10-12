import { Easing, interpolate } from "remotion";

export const FPS = 30;
export const s = (seconds: number) => Math.round(seconds * FPS);

/** 0 → 1 progress between two times (in seconds), clamped. */
export const prog = (t: number, from: number, to: number, easing = Easing.out(Easing.cubic)) =>
  interpolate(t, [from, to], [0, 1], { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** Visible between `from` and `to` with fades on both ends. */
export const visible = (t: number, from: number, to: number, fadeIn = 0.4, fadeOut = 0.4) =>
  Math.min(prog(t, from, from + fadeIn, Easing.linear), 1 - prog(t, to - fadeOut, to, Easing.linear));

export const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

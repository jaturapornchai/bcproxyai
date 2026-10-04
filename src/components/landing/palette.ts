function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/**
 * Stable neon hue per star id from an FNV-1a hash, so a star never flickers between colors. Hues skip the cyan (success)
 * and red (failure) bands used by packets. There is deliberately no name → colour table: this file ships in the public
 * landing bundle, which must not contain provider names.
 */
export function providerColor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const x = (h >>> 0) % 260;
  return hslToHex(x < 140 ? 25 + x : 75 + x, 0.95, 0.62); // 25..164 and 215..334
}

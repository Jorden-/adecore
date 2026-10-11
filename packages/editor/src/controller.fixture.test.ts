// The fallback face is 7.8px wide, with 20px lines and a 64px gutter.
const GUTTER = 64;

const column = (n: number): number => GUTTER + Math.round(n * 7.8);

const row = (n: number): number => n * 20 + 5;

export { GUTTER, column, row };

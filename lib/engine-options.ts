import type { UciOption } from './types';

/** Option names the extension reads out of an engine handshake. */
export const OPTION = {
  hash: 'Hash',
  threads: 'Threads',
  multiPv: 'MultiPV',
  skillLevel: 'Skill Level',
  skillLevelUnderscore: 'Skill_Level',
  limitStrength: 'UCI_LimitStrength',
  elo: 'UCI_Elo',
  aggressiveness: 'Aggressiveness',
  personality: 'Personality',
} as const;

const OPTION_TYPES: ReadonlyArray<UciOption['type']> = ['check', 'spin', 'combo', 'string', 'button'];

/**
 * Parses one `option name ... type ...` line from a `uci` handshake.
 * Returns null for anything that is not a well-formed option declaration.
 */
export function parseUciOptionLine(line: string): UciOption | null {
  if (!line.startsWith('option name ')) return null;

  const rest = line.slice('option name '.length);
  const typeAt = rest.indexOf(' type ');
  if (typeAt === -1) return null;

  const name = rest.slice(0, typeAt).trim();
  const tail = rest.slice(typeAt + ' type '.length);
  const type = tail.split(/\s+/)[0] ?? '';
  if (!name || !OPTION_TYPES.includes(type as UciOption['type'])) return null;

  const option: UciOption = { name, type: type as UciOption['type'] };

  const def = tail.match(/\bdefault\s+(\S+)/);
  if (def?.[1]) option.default = def[1];

  const min = tail.match(/\bmin\s+(-?\d+)/);
  if (min?.[1]) option.min = parseInt(min[1], 10);

  const max = tail.match(/\bmax\s+(-?\d+)/);
  if (max?.[1]) option.max = parseInt(max[1], 10);

  const vars = tail.match(/\bvar\s+(.+)$/);
  if (vars?.[1]) {
    option.vars = vars[1]
      .split(/\s+var\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return option;
}

export function formatSetOption(name: string, value: string | number | boolean): string {
  return `setoption name ${name} value ${value}`;
}

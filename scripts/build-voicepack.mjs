#!/usr/bin/env node
/**
 * build-voicepack.mjs — regenerates src/audio/voicepack.ts from a directory of mp3 clips.
 *
 * Usage:
 *   node scripts/build-voicepack.mjs <inputDir>
 *
 * <inputDir> must contain one mp3 per voice id, named `<id>.mp3` (e.g. scream_volt.mp3,
 * ann_go.mp3 — full id list below). The clips themselves are generated with ElevenLabs
 * (text_to_sound_effects for the KO screams, text_to_speech "Charlie" voice for the
 * announcer, output_format mp3_22050_32) — this script only post-processes and embeds
 * them, so the whole pack is reproducible/swappable while the repo ships zero binary
 * asset FILES (audio travels as base64 inside voicepack.ts).
 *
 * If ffmpeg/ffprobe are on PATH each clip is tightened before embedding:
 *   - leading/trailing silence trimmed (-50 dB floor, 50 ms padding kept)
 *   - peak-normalized to -1 dBFS
 *   - re-encoded mono 22.05 kHz 32 kbps mp3, metadata stripped
 * Without ffmpeg the clips are embedded as-is.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHARACTERS = ['volt', 'kaze', 'grim', 'ace', 'blaze', 'nova', 'shade', 'titan'];

/** Every voice id, in the order they appear in VOICE_DATA. Must match the VoiceId type. */
const VOICE_IDS = [
  ...CHARACTERS.map((c) => `scream_${c}`),
  'ann_bigfight',
  'ann_ready',
  'ann_3',
  'ann_2',
  'ann_1',
  'ann_go',
  'ann_game',
  'ann_readytofight',
  'ann_knockout',
  'ann_rematch',
  'ann_victory',
  'ann_coop',
  ...CHARACTERS.map((c) => `ann_name_${c}`),
  'ann_p1_wins',
  'ann_p2_wins',
  'ann_p3_wins',
  'ann_p4_wins',
  'ann_team_pink_wins',
  'ann_team_cyan_wins',
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, '..', 'src', 'audio', 'voicepack.ts');

const inputDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!inputDir || !existsSync(inputDir)) {
  console.error('Usage: node scripts/build-voicepack.mjs <inputDir>');
  console.error('  <inputDir> must contain <voiceId>.mp3 for each of the ' + VOICE_IDS.length + ' voice ids.');
  process.exit(1);
}

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function hasTool(cmd) {
  try {
    return run(cmd, ['-version']).status === 0;
  } catch {
    return false;
  }
}

const ffmpegAvailable = hasTool('ffmpeg') && hasTool('ffprobe');
if (!ffmpegAvailable) {
  console.warn('ffmpeg/ffprobe not found on PATH — embedding clips as-is (no trim/normalize).');
}

/** Parse `max_volume: -3.2 dB` from ffmpeg volumedetect stderr. */
function detectPeakDb(file) {
  const res = run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(res.stderr ?? '');
  return m ? parseFloat(m[1]) : null;
}

function probeDuration(file) {
  const res = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = parseFloat((res.stdout ?? '').trim());
  return Number.isFinite(d) ? d : null;
}

const TRIM =
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,' +
  'areverse,' +
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,' +
  'areverse';

/** Trim + normalize + re-encode one clip; returns the processed bytes (or null on failure). */
function processClip(src, dst) {
  const peak = detectPeakDb(src);
  // Peak-normalize to -1 dBFS (skip if volumedetect failed).
  const gain = peak === null ? 0 : -1 - peak;
  const filters = `${TRIM},volume=${gain.toFixed(2)}dB`;
  const res = run('ffmpeg', [
    '-hide_banner', '-y',
    '-i', src,
    '-af', filters,
    '-ac', '1',
    '-ar', '22050',
    '-c:a', 'libmp3lame',
    '-b:a', '32k',
    '-map_metadata', '-1',
    '-id3v2_version', '0', // no ID3 header at all — clips start straight at an mp3 frame
    dst,
  ]);
  if (res.status !== 0 || !existsSync(dst)) return null;
  return readFileSync(dst);
}

const tmp = ffmpegAvailable ? mkdtempSync(join(tmpdir(), 'voicepack-')) : null;
const clips = []; // { id, bytes: Buffer, seconds: number }
const missing = [];

for (const id of VOICE_IDS) {
  const src = join(inputDir, `${id}.mp3`);
  if (!existsSync(src)) {
    missing.push(id);
    continue;
  }
  let bytes = null;
  let probed = null;
  if (ffmpegAvailable) {
    const dst = join(tmp, `${id}.mp3`);
    bytes = processClip(src, dst);
    if (bytes) probed = probeDuration(dst);
    if (!bytes) console.warn(`ffmpeg failed on ${id} — embedding raw file.`);
  }
  if (!bytes) {
    bytes = readFileSync(src);
    if (ffmpegAvailable) probed = probeDuration(src);
  }
  // Fallback duration estimate for the no-ffprobe path: CBR 32 kbps.
  const seconds = probed ?? (bytes.length * 8) / 32000;
  clips.push({ id, bytes, seconds });
}

if (tmp) rmSync(tmp, { recursive: true, force: true });

if (missing.length) {
  console.error(`Missing ${missing.length} clip(s) in ${inputDir}:\n  ` + missing.join('\n  '));
  process.exit(1);
}

const totalBytes = clips.reduce((n, c) => n + c.bytes.length, 0);
const totalB64 = clips.reduce((n, c) => n + c.bytes.toString('base64').length, 0);

const pad = (s, n) => String(s).padEnd(n);
const manifestComment = clips
  .map((c) => `//   ${pad(c.id, 20)} ${pad(c.bytes.length + ' B', 9)} ${c.seconds.toFixed(2)}s`)
  .join('\n');

const charUnion = CHARACTERS.map((c) => `'${c}'`).join('|');

const ts = `// Generated by scripts/build-voicepack.mjs — do not hand-edit the data blocks.
// BIG FIGHT voice pack: ElevenLabs-generated, base64-embedded (repo stays zero asset FILES).
//
// VOICE_MANIFEST (clip → mp3 bytes → duration):
${manifestComment}
//   ${pad('TOTAL', 20)} ${totalBytes} B mp3 → ${totalB64} chars base64

export type VoiceId =
  | \`scream_\${${charUnion}}\`
  | 'ann_bigfight' | 'ann_ready' | 'ann_3' | 'ann_2' | 'ann_1' | 'ann_go' | 'ann_game'
  | 'ann_readytofight' | 'ann_knockout' | 'ann_rematch' | 'ann_victory' | 'ann_coop'
  | \`ann_name_\${${charUnion}}\`
  | \`ann_p\${1|2|3|4}_wins\` | 'ann_team_pink_wins' | 'ann_team_cyan_wins';

export const VOICE_DATA: Record<VoiceId, string> = {
${clips.map((c) => `  ${c.id}:\n    '${c.bytes.toString('base64')}',`).join('\n')}
};

/** Per-clip mp3 byte sizes and durations (seconds), for HUD/debug and budget checks. */
export const VOICE_MANIFEST: Record<VoiceId, { bytes: number; seconds: number }> = {
${clips.map((c) => `  ${c.id}: { bytes: ${c.bytes.length}, seconds: ${c.seconds.toFixed(3)} },`).join('\n')}
};

const bufferCache = new Map<VoiceId, Promise<AudioBuffer>>();

/** Decode one clip lazily into an AudioBuffer (cached). */
export async function getVoiceBuffer(ctx: AudioContext, id: VoiceId): Promise<AudioBuffer> {
  let pending = bufferCache.get(id);
  if (!pending) {
    pending = decodeClip(ctx, id);
    // Don't poison the cache with a failed decode (e.g. ctx torn down mid-flight).
    pending.catch(() => bufferCache.delete(id));
    bufferCache.set(id, pending);
  }
  return pending;
}

function decodeClip(ctx: AudioContext, id: VoiceId): Promise<AudioBuffer> {
  const bin = atob(VOICE_DATA[id]);
  // Fresh copy — decodeAudioData detaches the ArrayBuffer it's given.
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Promise<AudioBuffer>((resolvePromise, rejectPromise) => {
    // Callback form works everywhere (older Safari returns void); newer engines also
    // return a promise — wire up both, extra settles are no-ops.
    const maybePromise = ctx.decodeAudioData(
      bytes.buffer as ArrayBuffer,
      (buf) => resolvePromise(buf),
      (err) => rejectPromise(err ?? new Error(\`voicepack: failed to decode \${id}\`)),
    );
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(resolvePromise, rejectPromise);
    }
  });
}
`;

writeFileSync(OUT_FILE, ts);

console.log(`Wrote ${OUT_FILE}`);
console.log(`  clips: ${clips.length}`);
console.log(`  mp3 total: ${(totalBytes / 1024).toFixed(1)} KB → base64: ${(totalB64 / 1024).toFixed(1)} KB`);
for (const c of clips) console.log(`  ${pad(c.id, 20)} ${pad(c.bytes.length, 7)} ${c.seconds.toFixed(2)}s`);

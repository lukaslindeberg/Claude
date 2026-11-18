/**
 * Reads the lobby's tribes from the hero-pick screen ("In this game: Beasts, ...").
 * Hearthstone's log doesn't contain them, but the game prints them on screen.
 *
 * Windows only: captures the Hearthstone window (not the screen, so the overlay is not
 * in the picture), crops the lower right where the panels are, and runs Windows' own
 * OCR (Windows.Media.Ocr via PowerShell). Nothing is stored or sent anywhere; the
 * temporary image is deleted right after.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { desktopCapturer, nativeImage, type NativeImage } from 'electron';
import type { Tribe } from '@shared/types';
import { createLogger } from '../logger';
import { parseLobbyTribesText } from './tribeText';

const log = createLogger('tribes');

/** Part of the window searched (fractions): the panels sit at the lower right. */
const CROP = { x0: 0.55, x1: 1, y0: 0.55, y1: 1 };
const OCR_TIMEOUT_MS = 20_000;

const OCR_SCRIPT = String.raw`
param([string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$lang = New-Object Windows.Globalization.Language 'en-US'
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
foreach ($line in $result.Lines) { $line.Text }
`;

export function tribeReaderSupported(): boolean {
  return process.platform === 'win32';
}

/** Light text on dark stone -> dark text on white, 2x larger: OCR reads it far better. */
function prepare(img: NativeImage): NativeImage {
  const { width, height } = img.getSize();
  const big = img.resize({ width: width * 2, height: height * 2, quality: 'best' });
  const size = big.getSize();
  const px = big.toBitmap(); // BGRA
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.114 * px[i] + 0.587 * px[i + 1] + 0.299 * px[i + 2];
    const v = 255 - Math.min(255, Math.max(0, (lum - 60) * 1.6));
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(px, { width: size.width, height: size.height });
}

/** True for an (almost) uniform image, e.g. a black capture of a GPU-rendered window. */
function isBlank(img: NativeImage): boolean {
  const px = img.toBitmap();
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4 * 97) {
    const v = px[i + 1];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min < 12;
}

async function captureGameWindow(size: { width: number; height: number }): Promise<NativeImage | undefined> {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false });
  const src = sources.find((s) => s.name === 'Hearthstone') ?? sources.find((s) => /^hearthstone$/i.test(s.name.trim()));
  if (!src || src.thumbnail.isEmpty()) return undefined;
  return src.thumbnail;
}

function runOcr(scriptPath: string, imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Path', imagePath], {
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('OCR timed out'));
    }, OCR_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`OCR exited with ${code}: ${err.trim().split('\n')[0] ?? ''}`));
    });
  });
}

export interface TribeReadResult {
  tribes?: Tribe[];
  /** Why nothing was read (for the diagnostics log). */
  reason?: string;
}

/** One attempt: capture, crop, OCR, parse. `windowSize` is the game window in screen pixels. */
export async function readLobbyTribes(windowSize: { width: number; height: number }): Promise<TribeReadResult> {
  if (!tribeReaderSupported()) return { reason: 'not supported on this platform' };
  const shot = await captureGameWindow(windowSize);
  if (!shot) return { reason: 'Hearthstone window not capturable' };
  const { width, height } = shot.getSize();
  const crop = shot.crop({
    x: Math.round(width * CROP.x0),
    y: Math.round(height * CROP.y0),
    width: Math.round(width * (CROP.x1 - CROP.x0)),
    height: Math.round(height * (CROP.y1 - CROP.y0)),
  });
  if (isBlank(crop)) return { reason: 'captured image is blank (window capture not supported for this window?)' };
  const dir = await fs.mkdtemp(join(tmpdir(), 'tavern-lens-'));
  const imagePath = join(dir, 'tribes.png');
  const scriptPath = join(dir, 'ocr.ps1');
  try {
    await fs.writeFile(imagePath, prepare(crop).toPNG());
    await fs.writeFile(scriptPath, OCR_SCRIPT, 'utf8');
    const text = await runOcr(scriptPath, imagePath);
    const parsed = parseLobbyTribesText(text);
    if (!parsed) {
      log.debug(`tribe panel not recognised in: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
      return { reason: 'tribe panel not recognised' };
    }
    return { tribes: parsed.inGame };
  } finally {
    void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

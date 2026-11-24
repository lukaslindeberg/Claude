/**
 * System facts for the session header and `system.json` (Electron).
 */
import os from 'node:os';
import { app, screen } from 'electron';

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  bounds: Electron.Rectangle;
  workArea: Electron.Rectangle;
  scaleFactor: number;
  rotation: number;
  internal: boolean;
  frequency?: number;
}

export interface SystemInfo {
  app: { name: string; version: string; packaged: boolean; exe: string; locale: string; pid: number; uptimeSec: number };
  versions: { electron?: string; chrome?: string; node: string; v8?: string };
  os: { platform: string; release: string; version: string; arch: string; cpus: string; cpuCount: number; memoryGb: number; freeMemoryGb: number };
  displays: DisplayInfo[];
  gpu?: unknown;
  memory: { rssMb: number; heapUsedMb: number };
}

const mb = (n: number) => Math.round(n / (1024 * 1024));

export function displays(): DisplayInfo[] {
  try {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label,
      primary: d.id === primary,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      rotation: d.rotation,
      internal: d.internal,
      frequency: d.displayFrequency,
    }));
  } catch {
    return [];
  }
}

export function systemInfo(): SystemInfo {
  const cpus = os.cpus();
  let gpu: unknown;
  try {
    gpu = app.getGPUFeatureStatus();
  } catch {
    gpu = undefined;
  }
  const mem = process.memoryUsage();
  return {
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      exe: process.execPath,
      locale: app.getLocale(),
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
    },
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
    },
    os: {
      platform: process.platform,
      release: os.release(),
      version: typeof os.version === 'function' ? os.version() : '',
      arch: process.arch,
      cpus: cpus[0]?.model?.trim() ?? '?',
      cpuCount: cpus.length,
      memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      freeMemoryGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    },
    displays: displays(),
    gpu,
    memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed) },
  };
}

const rect = (r: Electron.Rectangle) => `${r.width}x${r.height} at ${r.x},${r.y}`;

export function describeDisplay(d: DisplayInfo, i: number): string {
  return `display ${i + 1}${d.primary ? ' (primary)' : ''}: ${rect(d.bounds)} · scale ${d.scaleFactor} · work area ${rect(d.workArea)}${d.rotation ? ` · rotated ${d.rotation}` : ''}${d.frequency ? ` · ${d.frequency} Hz` : ''} · id ${d.id}`;
}

export interface SessionHeaderExtra {
  hearthstoneInstall?: string;
  logsDir?: string;
  powerLog?: string;
  logConfig: string;
  logConfigPath?: string;
  cardData: string;
  settings: unknown;
  logFile?: string;
  verbose: boolean;
}

/** Multi-line session header (no BattleTags or other personal data beyond paths). */
export function sessionHeader(info: SystemInfo, x: SessionHeaderExtra): string {
  const lines = [
    `===== Tavern Lens ${info.app.version} session (${info.app.packaged ? 'packaged' : 'dev'}, pid ${info.app.pid}) =====`,
    `electron ${info.versions.electron ?? '?'} · chrome ${info.versions.chrome ?? '?'} · node ${info.versions.node}`,
    `os ${info.os.platform} ${info.os.release}${info.os.version ? ` (${info.os.version})` : ''} ${info.os.arch} · ${info.os.cpuCount}x ${info.os.cpus} · ${info.os.memoryGb} GB RAM · locale ${info.app.locale}`,
    ...info.displays.map(describeDisplay),
    `hearthstone install: ${x.hearthstoneInstall ?? 'not found'}`,
    `hearthstone logs: ${x.logsDir ?? '-'}`,
    `power.log: ${x.powerLog ?? '-'}`,
    `log.config: ${x.logConfig}${x.logConfigPath ? ` (${x.logConfigPath})` : ''}`,
    `card data: ${x.cardData}`,
    `log file: ${x.logFile ?? '-'} · verbose ${x.verbose ? 'on' : 'off'}`,
    `settings: ${JSON.stringify(x.settings)}`,
  ];
  return lines.join('\n');
}

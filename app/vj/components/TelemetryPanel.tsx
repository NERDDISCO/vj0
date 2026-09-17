"use client";

import React from "react";

/* ─────────────────────────────────────────────────────────────
   Pod telemetry — shape of /telemetry response from the worker's
   WebRTC server. Every nested object can be null, and every field
   within can be null/missing — the panel renders gracefully
   against partial data so a half-booted worker still shows
   something useful.
   ───────────────────────────────────────────────────────────── */
export interface TelemetrySnapshot {
  pod: {
    id: string | null;
    hostname: string | null;
    datacenter: string | null;
    image: string | null;
    publicIp: string | null;
  } | null;
  cpu: {
    model: string | null;
    cores: number;
    loadAvg1: number;
    loadAvg5: number;
  } | null;
  ram: {
    totalBytes: number;
    usedBytes: number;
  } | null;
  disk: {
    mount: string;
    totalBytes: number;
    usedBytes: number;
  } | null;
  networkVolume: {
    present: boolean;
    id: string | null;
    mount: string;
  } | null;
  gpus: Array<{
    index: number;
    name: string | null;
    vramTotalMb: number | null;
    vramUsedMb: number | null;
    utilPct: number;
    tempC: number | null;
    powerW: number | null;
  }>;
  workers: Array<{
    gpu: number;
    ready: boolean;
    framePending: number;
    framesProduced: number;
    lastFrameAt: number;
  }>;
  serverUptimeS: number;
}

interface TelemetryPanelProps {
  snapshot: TelemetrySnapshot | null;
  /** True while the popover is open and we're still waiting for the first
      successful /telemetry response. Drives the skeleton state. */
  loading: boolean;
  /** Last fetch error message, if any. Populated when /telemetry is
      unreachable (worker booting, network blip, old image without route). */
  error: string | null;
  /** Tick of the most recent successful fetch (Date.now()). Drives the
      "live" indicator pulse animation. */
  lastTick: number | null;
}

/**
 * TelemetryPanel — pod hardware readout, sized for the SystemsBar AI pop-over.
 *
 * Lives inside the AI pop-over (the worker IS the AI backend's pod), so the
 * parent gates rendering on `aiStatus === "connected"`. We don't need an
 * AI-offline empty state because the pop-over surfaces the Connect button
 * a few rows above when AI isn't connected.
 *
 * Designed like a hardware diagnostics strip rather than a generic dashboard:
 * each section is a thin labeled module, meter bars are the visual primary,
 * everything else is tabular-aligned monospace text. The meter color shifts
 * from cool cyan (idle) → emerald (active) → magenta (hot/saturated) so a
 * stage tech can read load at a glance without parsing numbers.
 */
export function TelemetryPanel({
  snapshot,
  loading,
  error,
  lastTick,
}: TelemetryPanelProps) {
  if (loading && !snapshot) {
    return <Skeleton />;
  }
  if (error && !snapshot) {
    return (
      <EmptyState
        title="unreachable"
        body={error}
      />
    );
  }
  if (!snapshot) return null;

  const { pod, cpu, ram, disk, networkVolume, gpus, workers, serverUptimeS } =
    snapshot;

  return (
    <div className="vj-telemetry">
      <Header
        uptimeS={serverUptimeS}
        lastTick={lastTick}
        readyWorkers={workers.filter((w) => w.ready).length}
        totalWorkers={workers.length}
      />

      {pod && <PodSection pod={pod} networkVolume={networkVolume} />}

      {gpus.length > 0 && <GpuSection gpus={gpus} />}

      {workers.length > 0 && <WorkersSection workers={workers} />}

      <SystemSection cpu={cpu} ram={ram} disk={disk} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Header — uptime + live tick + worker readiness
   ════════════════════════════════════════════════════════════════ */
function Header({
  uptimeS,
  lastTick,
  readyWorkers,
  totalWorkers,
}: {
  uptimeS: number;
  lastTick: number | null;
  readyWorkers: number;
  totalWorkers: number;
}) {
  const allReady = totalWorkers > 0 && readyWorkers === totalWorkers;
  const tone = allReady ? "live" : totalWorkers > 0 ? "warn" : "muted";
  return (
    <div className="vj-telemetry__header">
      <div className="vj-telemetry__title-group">
        <span className="vj-telemetry__title">pod telemetry</span>
        <span className="vj-telemetry__uptime">up {formatUptime(uptimeS)}</span>
      </div>
      <div className="vj-telemetry__live">
        <span
          className={`vj-telemetry__tick ${
            lastTick != null ? "vj-telemetry__tick--on" : ""
          }`}
          aria-hidden
        />
        <span style={{ color: toneColor(tone) }}>
          {readyWorkers}/{totalWorkers}
        </span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Pod section — id / dc / image / network volume
   ════════════════════════════════════════════════════════════════ */
function PodSection({
  pod,
  networkVolume,
}: {
  pod: NonNullable<TelemetrySnapshot["pod"]>;
  networkVolume: TelemetrySnapshot["networkVolume"];
}) {
  return (
    <Section label="pod">
      <Row k="id" v={pod.id ?? "—"} mono />
      <Row
        k="dc"
        v={
          <span className="vj-telemetry__dc">
            <span>{pod.datacenter ?? "local"}</span>
            <span className="vj-telemetry__sep">·</span>
            <span
              className={`vj-telemetry__vol ${
                networkVolume?.present
                  ? "vj-telemetry__vol--on"
                  : "vj-telemetry__vol--off"
              }`}
            >
              {networkVolume?.present ? "vol ✓" : "vol ✕"}
            </span>
          </span>
        }
      />
      {pod.image && <Row k="img" v={pod.image} mono truncate />}
    </Section>
  );
}

/* ════════════════════════════════════════════════════════════════
   GPU section — per-card meter row
   ════════════════════════════════════════════════════════════════ */
function GpuSection({
  gpus,
}: {
  gpus: TelemetrySnapshot["gpus"];
}) {
  return (
    <Section label="gpu">
      {gpus.map((g) => (
        <GpuRow key={g.index} gpu={g} />
      ))}
    </Section>
  );
}

function GpuRow({ gpu }: { gpu: TelemetrySnapshot["gpus"][number] }) {
  const vramPct =
    gpu.vramTotalMb && gpu.vramUsedMb
      ? Math.min(100, (gpu.vramUsedMb / gpu.vramTotalMb) * 100)
      : 0;
  const utilTone = utilToTone(gpu.utilPct);
  const vramTone = utilToTone(vramPct);
  return (
    <div className="vj-telemetry__gpu">
      <div className="vj-telemetry__gpu-line">
        <span className="vj-telemetry__idx">{gpu.index}</span>
        <span className="vj-telemetry__gpu-name" title={gpu.name ?? ""}>
          {abbrevGpu(gpu.name)}
        </span>
        <span className="vj-telemetry__gpu-meta">
          {gpu.tempC != null && <span>{gpu.tempC}°</span>}
          {gpu.powerW != null && <span>{Math.round(gpu.powerW)}w</span>}
        </span>
      </div>
      <Meter
        label="util"
        pct={gpu.utilPct}
        tone={utilTone}
        readout={`${Math.round(gpu.utilPct)}%`}
      />
      <Meter
        label="vram"
        pct={vramPct}
        tone={vramTone}
        readout={
          gpu.vramTotalMb && gpu.vramUsedMb
            ? `${(gpu.vramUsedMb / 1024).toFixed(1)}/${(
                gpu.vramTotalMb / 1024
              ).toFixed(1)}g`
            : "—"
        }
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Workers section — per-worker readiness + frame counters
   ════════════════════════════════════════════════════════════════ */
function WorkersSection({
  workers,
}: {
  workers: TelemetrySnapshot["workers"];
}) {
  return (
    <Section label="workers">
      {workers.map((w) => (
        <div key={w.gpu} className="vj-telemetry__worker">
          <span className="vj-telemetry__idx">{w.gpu}</span>
          <span
            className="vj-dot"
            style={{
              color: w.ready ? "var(--vj-live)" : "var(--vj-warn)",
            }}
          />
          <span className="vj-telemetry__worker-state">
            {w.ready ? "ready" : "boot"}
          </span>
          <span className="vj-telemetry__sep">·</span>
          <span className="vj-telemetry__worker-pending">
            {w.framePending} q
          </span>
          <span className="vj-telemetry__sep">·</span>
          <span className="vj-telemetry__worker-frames">
            {abbrevCount(w.framesProduced)} f
          </span>
        </div>
      ))}
    </Section>
  );
}

/* ════════════════════════════════════════════════════════════════
   System section — cpu / ram / disk meters
   ════════════════════════════════════════════════════════════════ */
function SystemSection({
  cpu,
  ram,
  disk,
}: {
  cpu: TelemetrySnapshot["cpu"];
  ram: TelemetrySnapshot["ram"];
  disk: TelemetrySnapshot["disk"];
}) {
  if (!cpu && !ram && !disk) return null;
  // CPU "load" pct uses load1 / cores as a rough utilization proxy. Linux
  // load can exceed cores under contention, so clamp the meter at 100% but
  // still show the raw number in the readout.
  const cpuPct = cpu
    ? Math.min(100, ((cpu.loadAvg1 || 0) / Math.max(1, cpu.cores)) * 100)
    : 0;
  const ramPct =
    ram && ram.totalBytes > 0 ? (ram.usedBytes / ram.totalBytes) * 100 : 0;
  const diskPct =
    disk && disk.totalBytes > 0 ? (disk.usedBytes / disk.totalBytes) * 100 : 0;

  return (
    <Section label="system">
      {cpu && (
        <div className="vj-telemetry__cpu-line" title={cpu.model ?? ""}>
          <span className="vj-telemetry__cpu-model">
            {abbrevCpu(cpu.model)}
          </span>
          <span className="vj-telemetry__cpu-cores">{cpu.cores}c</span>
        </div>
      )}
      {cpu && (
        <Meter
          label="cpu"
          pct={cpuPct}
          tone={utilToTone(cpuPct)}
          readout={cpu.loadAvg1.toFixed(2)}
        />
      )}
      {ram && (
        <Meter
          label="ram"
          pct={ramPct}
          tone={utilToTone(ramPct)}
          readout={`${formatBytes(ram.usedBytes)}/${formatBytes(ram.totalBytes)}`}
        />
      )}
      {disk && (
        <Meter
          label="disk"
          pct={diskPct}
          tone={utilToTone(diskPct)}
          readout={`${formatBytes(disk.usedBytes)}/${formatBytes(
            disk.totalBytes
          )}`}
        />
      )}
    </Section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Primitives
   ════════════════════════════════════════════════════════════════ */

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="vj-telemetry__section">
      <div className="vj-telemetry__section-label">{label}</div>
      <div className="vj-telemetry__section-body">{children}</div>
    </div>
  );
}

function Row({
  k,
  v,
  mono = false,
  truncate = false,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="vj-telemetry__row">
      <span className="vj-telemetry__k">{k}</span>
      <span
        className={`vj-telemetry__v ${mono ? "vj-telemetry__v--mono" : ""} ${
          truncate ? "vj-telemetry__v--truncate" : ""
        }`}
      >
        {v}
      </span>
    </div>
  );
}

/**
 * Inline meter — the single load-bearing visual. A horizontal bar that
 * fills left-to-right, with a tone-colored fill that shifts with load
 * (cyan → emerald → warn → magenta as the value climbs). The readout
 * is right-aligned tabular text so 0..100 stays in one column even as
 * digit count shifts.
 */
function Meter({
  label,
  pct,
  tone,
  readout,
}: {
  label: string;
  pct: number;
  tone: Tone;
  readout: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="vj-telemetry__meter">
      <span className="vj-telemetry__meter-label">{label}</span>
      <div className="vj-telemetry__meter-track">
        <div
          className="vj-telemetry__meter-fill"
          style={{
            width: `${clamped}%`,
            background: toneColor(tone),
            boxShadow: `0 0 6px -1px ${toneColor(tone)}`,
          }}
        />
      </div>
      <span
        className="vj-telemetry__meter-readout"
        style={{ color: toneColor(tone) }}
      >
        {readout}
      </span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="vj-telemetry vj-telemetry--loading">
      <div className="vj-telemetry__header">
        <span className="vj-telemetry__title">pod telemetry</span>
        <span className="vj-telemetry__live vj-telemetry__live--idle">probing…</span>
      </div>
      {(["pod", "gpu", "system"] as const).map((label) => (
        <div className="vj-telemetry__section" key={label}>
          <div className="vj-telemetry__section-label">{label}</div>
          <div className="vj-telemetry__section-body">
            <div className="vj-telemetry__skeleton-row" />
            <div className="vj-telemetry__skeleton-row" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="vj-telemetry vj-telemetry--empty">
      <div className="vj-telemetry__empty-title">{title}</div>
      <div className="vj-telemetry__empty-body">{body}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Formatters + tone helpers
   ════════════════════════════════════════════════════════════════ */

type Tone = "live" | "info" | "warn" | "error" | "muted";

function toneColor(tone: Tone): string {
  switch (tone) {
    case "live":
      return "var(--vj-live)";
    case "info":
      return "var(--vj-info)";
    case "warn":
      return "var(--vj-warn)";
    case "error":
      return "var(--vj-accent)";
    case "muted":
      return "var(--vj-muted)";
  }
}

/**
 * Utilization percent → tone. Calibrated for live-set glance reading:
 *   <  5 %  muted   — idle, irrelevant
 *   <  60 % info    — running normally
 *   <  85 % live    — busy but healthy
 *   <  95 % warn    — saturated, watch
 *   ≥  95 % error   — pinned, alarm
 */
function utilToTone(pct: number): Tone {
  if (pct < 5) return "muted";
  if (pct < 60) return "info";
  if (pct < 85) return "live";
  if (pct < 95) return "warn";
  return "error";
}

/** "NVIDIA GeForce RTX 5090" → "RTX 5090". Keeps the meaningful suffix
    without eating the row's horizontal budget. */
function abbrevGpu(name: string | null): string {
  if (!name) return "—";
  const m = name.match(/RTX\s*\d{4}\s*(Ti|Super)?/i);
  if (m) return m[0].replace(/\s+/g, " ");
  const a100 = name.match(/A\d{2,3}/);
  if (a100) return a100[0];
  const h100 = name.match(/H\d{2,3}/);
  if (h100) return h100[0];
  // Last-resort: first three words.
  return name.split(/\s+/).slice(0, 3).join(" ");
}

/** "AMD EPYC 7B13 64-Core Processor" → "EPYC 7B13" — keep the model number. */
function abbrevCpu(model: string | null): string {
  if (!model) return "—";
  const epyc = model.match(/EPYC\s+\w+/i);
  if (epyc) return epyc[0];
  const xeon = model.match(/Xeon\s+\S+/i);
  if (xeon) return xeon[0];
  const ryzen = model.match(/Ryzen\s+\S+\s+\S+/i);
  if (ryzen) return ryzen[0];
  // Strip anything past the first multi-space gap to keep it compact.
  return model.split(/\s{2,}/)[0].slice(0, 24);
}

function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return "0";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  const TB = GB * 1024;
  if (b >= TB) return `${(b / TB).toFixed(1)}T`;
  if (b >= GB) return `${(b / GB).toFixed(b >= 100 * GB ? 0 : 1)}G`;
  if (b >= MB) return `${(b / MB).toFixed(0)}M`;
  return `${(b / KB).toFixed(0)}K`;
}

function formatUptime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

function abbrevCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

import { VJApp } from "../vj/VJAppLoader";

export const metadata = {
  title: "vj0 — legacy console",
  description:
    "Original VJ0 layout — kept available for A/B comparison and for " +
    "features the new Patch Studio hasn't ported yet (full DMX panel, " +
    "WebRTC AI transport, recording pipeline).",
};

export default function VjLegacyPage() {
  return (
    <main className="min-h-screen w-screen bg-[#0a0a0f] text-neutral-200">
      <VJApp />
    </main>
  );
}

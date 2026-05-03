import { NextResponse } from "next/server";

/**
 * GET /api/pods — list running vj0 pods from RunPod.
 *
 * Server-side only: the RUNPOD_API_KEY never reaches the browser.
 * For each running pod with the vj0 worker image, we check /healthz
 * to report GPU readiness.  The frontend uses this to let the user
 * pick which pod to connect to.
 */

export interface PodInfo {
  id: string;
  name: string;
  gpuCount: number;
  gpuDisplayName: string;
  location: string;
  dataCenterId: string;
  costPerHr: number;
  signalingUrl: string;
  ready: boolean;
  readyCount: number;
  workerCount: number;
  inferenceReady: boolean;
  env: Record<string, string>;
}

const RUNPOD_GQL = "https://api.runpod.io/graphql";
const VJ0_IMAGE_PREFIX = "nerddisco/vj0-flux2klein-worker";

export async function GET() {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "RUNPOD_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch all running pods
    const gqlRes = await fetch(`${RUNPOD_GQL}?api_key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query {
          myself {
            pods {
              id
              name
              desiredStatus
              imageName
              gpuCount
              costPerHr
              machine {
                gpuDisplayName
                location
                dataCenterId
              }
              env {
                key
                value
              }
            }
          }
        }`,
      }),
      // Don't cache — we want fresh pod status
      cache: "no-store",
    });

    const gqlData = await gqlRes.json();
    const allPods = gqlData?.data?.myself?.pods ?? [];

    // Filter to running vj0 worker pods
    const vj0Pods = allPods.filter(
      (p: Record<string, unknown>) =>
        p.desiredStatus === "RUNNING" &&
        typeof p.imageName === "string" &&
        (p.imageName as string).startsWith(VJ0_IMAGE_PREFIX)
    );

    // Check health of each pod in parallel
    const pods: PodInfo[] = await Promise.all(
      vj0Pods.map(async (p: Record<string, unknown>) => {
        const id = p.id as string;
        const machine = (p.machine as Record<string, string>) ?? {};
        const signalingUrl = `https://${id}-3000.proxy.runpod.net/webrtc/offer`;

        // Parse env array into a flat object
        const envArr = (p.env as Array<{ key: string; value: string }>) ?? [];
        const env: Record<string, string> = {};
        for (const e of envArr) {
          if (e.key && e.value) env[e.key] = e.value;
        }

        // Check healthz (fast timeout — don't block the whole response)
        let ready = false;
        let readyCount = 0;
        let workerCount = 0;
        let inferenceReady = false;

        try {
          const hRes = await fetch(
            `https://${id}-3000.proxy.runpod.net/healthz`,
            { signal: AbortSignal.timeout(3000), cache: "no-store" }
          );
          if (hRes.ok) {
            const h = await hRes.json();
            readyCount = h.readyCount ?? 0;
            workerCount = h.workerCount ?? 0;
            inferenceReady = h.inferenceReady ?? false;
            ready = inferenceReady;
          }
        } catch {
          // Pod not reachable yet — that's fine, just report not ready
        }

        return {
          id,
          name: p.name as string,
          gpuCount: p.gpuCount as number,
          gpuDisplayName: machine.gpuDisplayName ?? "Unknown",
          location: machine.location ?? "?",
          dataCenterId: machine.dataCenterId ?? "?",
          costPerHr: p.costPerHr as number,
          signalingUrl,
          ready,
          readyCount,
          workerCount,
          inferenceReady,
          env,
        };
      })
    );

    // Sort: ready pods first, then by location
    pods.sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return a.location.localeCompare(b.location);
    });

    return NextResponse.json({ pods });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch pods: ${err}` },
      { status: 500 }
    );
  }
}

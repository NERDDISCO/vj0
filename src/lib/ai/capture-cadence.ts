// rAF timestamps are quantized and can straddle an exact frame interval by a
// fraction of a millisecond. Keep an absolute deadline instead of resetting a
// stopwatch on each callback, which otherwise skips healthy frame opportunities.
const FRAME_TIME_TOLERANCE_MS = 0.5;

export function isCaptureFrameDue(timestamp: number, nextFrameTime: number): boolean {
  return timestamp + FRAME_TIME_TOLERANCE_MS >= nextFrameTime;
}

// Call only after a capture is admitted. Missed work is discarded; at most one
// fresh source frame is captured per rAF callback, including after a long pause.
export function advanceCaptureFrameDeadline(
  timestamp: number,
  nextFrameTime: number,
  frameRate: number,
): number {
  const interval = 1000 / frameRate;
  const next = nextFrameTime === 0 ? timestamp + interval : nextFrameTime + interval;
  return next <= timestamp + FRAME_TIME_TOLERANCE_MS ? timestamp + interval : next;
}

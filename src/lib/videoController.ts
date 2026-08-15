export interface VideoController {
  play(): void;
  pause(): void;
  seekBy(deltaSec: number): void;
}

let controller: VideoController | null = null;

export function setVideoController(c: VideoController | null): void {
  controller = c;
}

export function getVideoController(): VideoController | null {
  return controller;
}

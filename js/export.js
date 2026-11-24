// Annotated video export: MP4 (H.264) when the browser can encode it, otherwise WebM.
import {
  Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource,
  canEncodeVideo, getFirstEncodableVideoCodec, QUALITY_HIGH,
} from '../vendor/mediabunny/mediabunny.min.mjs';

/** Pick the container and codec this browser can produce. Returns null if video export is unavailable. */
export async function pickFormat(width, height) {
  if (typeof VideoEncoder === 'undefined') return null;
  if (await canEncodeVideo('avc', { width, height })) return { format: new Mp4OutputFormat(), codec: 'avc' };
  const webm = new WebMOutputFormat();
  const codec = await getFirstEncodableVideoCodec(webm.getSupportedVideoCodecs(), { width, height });
  return codec ? { format: webm, codec } : null;
}

/**
 * @param o { width, height, fps, frames, renderFrame(i, ctx) -> Promise, onProgress(i), isCancelled() }
 * @returns { blob, extension } or null when cancelled
 */
export async function exportVideo(o) {
  // H.264 needs even dimensions.
  const w = o.width - (o.width % 2), h = o.height - (o.height % 2);
  const picked = await pickFormat(w, h);
  if (!picked) throw new Error('This browser cannot encode video. Try a recent version of Chrome, Edge, or Safari.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const output = new Output({ format: picked.format, target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: picked.codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: o.fps });
  await output.start();
  for (let i = 0; i < o.frames; i++) {
    if (o.isCancelled()) {
      await output.cancel();
      return null;
    }
    await o.renderFrame(i, ctx);
    await source.add(i / o.fps, 1 / o.fps);
    o.onProgress(i + 1);
  }
  await output.finalize();
  return {
    blob: new Blob([output.target.buffer], { type: picked.format.mimeType }),
    extension: picked.format.fileExtension,
  };
}

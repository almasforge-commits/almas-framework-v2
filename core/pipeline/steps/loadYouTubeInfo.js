import { getYouTubeVideoInfo } from "../../../services/content/youtubeService.js";

/**
 * Normalized ingestion metadata contract (see docs/ARCHITECTURE.md):
 *
 * context.metadata.source = {
 *   type: string,                    // e.g. "youtube"
 *   title: string,
 *   url: string | null,
 *   author: string | null,
 *   duration: string | number | null, // opaque, source-defined (YouTube: pre-formatted "H:MM:SS")
 *   extra: object,                    // reserved for source-specific fields
 * }
 */
export async function loadYouTubeInfo(context, options = {}) {

  const { getYouTubeVideoInfoFn = getYouTubeVideoInfo } = options;

  const info = await getYouTubeVideoInfoFn(
    context.input.url
  );

  if (!info) {
    throw new Error("VIDEO_INFO_FAILED");
  }

  context.metadata.source = {
    type: "youtube",
    title: info.title,
    url: context.input.url,
    author: info.channel,
    duration: info.duration,
    extra: {},
  };

  return context;

}

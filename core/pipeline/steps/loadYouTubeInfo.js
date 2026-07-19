import { getYouTubeVideoInfo } from "../../../services/content/youtubeService.js";

export async function loadYouTubeInfo(context) {

  const info = await getYouTubeVideoInfo(
    context.input.url
  );

  if (!info) {
    throw new Error("VIDEO_INFO_FAILED");
  }

  context.metadata.video = info;

  return context;

}
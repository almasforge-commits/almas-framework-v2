import { YoutubeTranscript } from 'youtube-transcript';

const YOUTUBE_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\S+/i;

export function isYouTubeLink(text = '') {
  return YOUTUBE_URL_REGEX.test(text);
}

export async function getYouTubeTranscript(url) {
  if (!url || !isYouTubeLink(url)) {
    return {
      success: false,
      error: 'INVALID_URL',
    };
  }

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(url);

    const text = transcript
      .map((item) => item.text)
      .join(' ');

    return {
      success: true,
      transcript: text,
    };
  } catch (error) {
    console.error(error);

    return {
      success: false,
      error: error.message,
    };
  }
}
import { Innertube } from 'youtubei.js';

const YOUTUBE_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\S+/i;

let innertubeInstance = null;

async function getInnertube() {
  if (!innertubeInstance) {
    innertubeInstance = await Innertube.create();
  }
  return innertubeInstance;
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    ) {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return videoId;

      for (const segment of ['embed', 'shorts', 'live', 'v']) {
        const match = parsed.pathname.match(new RegExp(`^/${segment}/([^/?]+)`));
        if (match) return match[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) {
    return '0:00';
  }

  const total = Math.floor(Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function isYouTubeLink(text = '') {
  return YOUTUBE_URL_REGEX.test(text);
}

export async function getYouTubeVideoInfo(url) {
  if (!url || !isYouTubeLink(url)) {
    return null;
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return null;
  }

  try {
    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId);
    const { basic_info: basicInfo } = info;

    return {
      title: basicInfo.title ?? '',
      channel: basicInfo.channel?.name ?? basicInfo.author ?? '',
      duration: formatDuration(basicInfo.duration),
    };
  } catch {
    return null;
  }
}
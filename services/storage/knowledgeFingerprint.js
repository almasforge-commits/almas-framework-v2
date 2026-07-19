import crypto from "crypto";

export function generateKnowledgeFingerprint(data = {}) {

  const type = data.type ?? "unknown";

  switch (type) {

    case "youtube":
      return hash(getYouTubeVideoId(data.source?.url));

    case "website":
      return hash(normalizeUrl(data.source?.url));

    case "pdf":
      return hash(data.source?.fileHash);

    case "voice":
      return hash(data.source?.fileHash);

    case "image":
      return hash(data.source?.fileHash);

    case "note":
      return hash(normalize(data.summary));

    case "idea":
      return hash(normalize(data.summary));

    default:
      return hash(
        normalize(
          `${data.title ?? ""}${data.summary ?? ""}`
        )
      );

  }

}

function hash(value = "") {

  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");

}

function normalize(text = "") {

  return String(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

}

function normalizeUrl(url = "") {

  try {

    const parsed = new URL(url);

    parsed.hash = "";

    parsed.search = "";

    return parsed.toString().toLowerCase();

  } catch {

    return normalize(url);

  }

}

function getYouTubeVideoId(url = "") {

  if (!url) return "";

  try {

    const parsed = new URL(url);

    const host = parsed.hostname.replace("www.", "");

    if (host === "youtu.be") {
      return parsed.pathname.replace("/", "");
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com"
    ) {

      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v") ?? "";
      }

      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/")[2] ?? "";
      }

      if (parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.split("/")[2] ?? "";
      }

    }

  } catch {}

  return normalize(url);

}       
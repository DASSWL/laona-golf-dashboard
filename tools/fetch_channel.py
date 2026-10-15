#!/usr/bin/env python3
"""Pull a YouTube channel's public data via YouTube Data API v3 into tools/.cache/raw.json.

Usage (from the repo root):
  YOUTUBE_API_KEY=... python3 tools/fetch_channel.py [@handle]
  (or put YOUTUBE_API_KEY=... in .env at the repo root — it is git-ignored)
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://www.googleapis.com/youtube/v3/"
HANDLE = (sys.argv[1] if len(sys.argv) > 1 else "@laonagolf").lstrip("@")
TOP_COMMENT_VIDEOS = 12   # most-viewed videos to sample comments from
RECENT_COMMENT_VIDEOS = 8  # latest videos to sample comments from


def load_key():
    key = os.environ.get("YOUTUBE_API_KEY")
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.strip().startswith("YOUTUBE_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("YOUTUBE_API_KEY not set (env var or .env at the repo root)")
    return key


KEY = load_key()
quota = 0


def get(endpoint, **params):
    global quota
    params["key"] = KEY
    url = API + endpoint + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            quota += 1
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"{endpoint} HTTP {e.code}: {body[:400]}") from None


def paged(endpoint, limit=None, **params):
    items, token = [], None
    while True:
        if token:
            params["pageToken"] = token
        data = get(endpoint, **params)
        items += data.get("items", [])
        token = data.get("nextPageToken")
        if not token or (limit and len(items) >= limit):
            return items


def is_short(video_id):
    """youtube.com/shorts/<id> answers 200 for Shorts and redirects for normal videos."""
    req = urllib.request.Request(
        f"https://www.youtube.com/shorts/{video_id}",
        method="HEAD",
        headers={"User-Agent": "Mozilla/5.0"},
    )

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=8) as r:
            return r.status == 200
    except urllib.error.HTTPError as e:
        return False if e.code in (301, 302, 303, 307, 308) else None
    except Exception:
        return None


def main():
    ch = get(
        "channels",
        forHandle=HANDLE,
        part="snippet,statistics,brandingSettings,contentDetails,topicDetails,status",
    )
    if not ch.get("items"):
        sys.exit(f"No channel found for @{HANDLE}")
    channel = ch["items"][0]
    uploads = channel["contentDetails"]["relatedPlaylists"]["uploads"]
    print(f"Channel: {channel['snippet']['title']} ({channel['id']})")

    ids = [
        it["contentDetails"]["videoId"]
        for it in paged("playlistItems", playlistId=uploads, part="contentDetails", maxResults=50)
    ]
    print(f"Uploads: {len(ids)}")

    videos = []
    for i in range(0, len(ids), 50):
        videos += get(
            "videos",
            id=",".join(ids[i : i + 50]),
            part="snippet,statistics,contentDetails,status,topicDetails,liveStreamingDetails",
        ).get("items", [])

    with ThreadPoolExecutor(max_workers=12) as pool:
        for v, short in zip(videos, pool.map(is_short, [v["id"] for v in videos])):
            v["isShort"] = short
    print(f"Shorts detected: {sum(1 for v in videos if v.get('isShort'))}")

    playlists = paged("playlists", channelId=channel["id"], part="snippet,contentDetails", maxResults=50)
    for p in playlists:
        p["videoIds"] = [
            it["contentDetails"]["videoId"]
            for it in paged("playlistItems", playlistId=p["id"], part="contentDetails", maxResults=50)
        ]

    by_views = sorted(videos, key=lambda v: int(v["statistics"].get("viewCount", 0)), reverse=True)
    by_date = sorted(videos, key=lambda v: v["snippet"]["publishedAt"], reverse=True)
    sample = []
    for v in by_views[:TOP_COMMENT_VIDEOS] + by_date[:RECENT_COMMENT_VIDEOS]:
        if v["id"] not in sample and int(v["statistics"].get("commentCount", 0) or 0) > 0:
            sample.append(v["id"])
    comments = {}
    for vid in sample:
        try:
            comments[vid] = get(
                "commentThreads", videoId=vid, part="snippet", maxResults=50, order="relevance", textFormat="plainText"
            ).get("items", [])
        except RuntimeError as e:  # comments disabled etc.
            print("  skip comments", vid, str(e)[:80])
    print(f"Comment threads sampled: {sum(len(c) for c in comments.values())} across {len(comments)} videos")

    out = ROOT / "tools" / ".cache" / "raw.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "handle": "@" + HANDLE,
                "channel": channel,
                "videos": videos,
                "playlists": playlists,
                "comments": comments,
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    print(f"Wrote {out.relative_to(ROOT)} — quota used ≈ {quota} units")


if __name__ == "__main__":
    main()

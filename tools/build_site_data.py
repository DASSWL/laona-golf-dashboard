#!/usr/bin/env python3
"""Turn tools/.cache/raw.json (from fetch_channel.py) into the site's data/channel.json, videos.json and comments.json."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = json.loads((ROOT / "tools" / ".cache" / "raw.json").read_text())
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)


def seconds(iso):
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso)
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


ch = RAW["channel"]
banner = ch.get("brandingSettings", {}).get("image", {}).get("bannerExternalUrl")
channel = [{
    "channelId": ch["id"],
    "title": ch["snippet"]["title"],
    "handle": ch["snippet"].get("customUrl", RAW["handle"]),
    "joined": ch["snippet"]["publishedAt"],
    "country": ch["snippet"].get("country", ""),
    "subscribers": int(ch["statistics"]["subscriberCount"]),
    "views": int(ch["statistics"]["viewCount"]),
    "videoCount": int(ch["statistics"]["videoCount"]),
    "fetchedAt": RAW["fetchedAt"],
    "description": ch["snippet"]["description"].split("\n")[0],
    "avatar": ch["snippet"]["thumbnails"]["high"]["url"],
    "banner": banner + "=w1600-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj" if banner else "",
}]

lists_of = {}
for p in RAW["playlists"]:
    for vid in p["videoIds"]:
        lists_of.setdefault(vid, []).append(p["snippet"]["title"])

videos = []
for v in sorted(RAW["videos"], key=lambda v: v["snippet"]["publishedAt"]):
    s = v["statistics"]
    videos.append({
        "id": v["id"],
        "title": v["snippet"]["title"],
        "publishedAt": v["snippet"]["publishedAt"],
        "type": "short" if v.get("isShort") else "long",
        "durationSec": seconds(v["contentDetails"]["duration"]),
        "views": int(s.get("viewCount", 0) or 0),
        "likes": int(s.get("likeCount", 0) or 0),
        "comments": int(s.get("commentCount", 0) or 0),
        "playlists": "、".join(lists_of.get(v["id"], [])),
        "thumb": f"https://i.ytimg.com/vi/{v['id']}/mqdefault.jpg",
    })

titles = {v["id"]: v["title"] for v in videos}
comments = []
for vid, threads in RAW["comments"].items():
    for t in threads:
        c = t["snippet"]["topLevelComment"]["snippet"]
        comments.append({
            "commentId": t["id"],
            "videoId": vid,
            "videoTitle": titles.get(vid, ""),
            "text": c.get("textDisplay", ""),
            "likes": c.get("likeCount", 0),
            "replies": t["snippet"].get("totalReplyCount", 0),
            "publishedAt": c.get("publishedAt", ""),
            "isCreator": c.get("authorChannelId", {}).get("value") == ch["id"],
        })
comments.sort(key=lambda c: -c["likes"])

for name, rows in (("channel", channel), ("videos", videos), ("comments", comments)):
    (OUT / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
    print(f"data/{name}.json: {len(rows)} rows")

/* 老那高尔夫频道仪表盘 — calculations and drawing (standalone site; `dash` comes from dash-shim.js). */

/* ======================= calculations ======================= */

dash.calc('scored', {
  title: '每支视频的成绩',
  description: '每支视频的内容支柱（按播放列表归类）、互动率、日均播放，以及播放相对“标准杆”（同格式前 10 支视频播放中位数）的倍数和杆数。',
  inputs: ['videos', 'channel'],
  fn: (videos, channel) => {
    const pillars = {
      教学: ['高尔夫教学', '高尔夫新手入门', '高尔夫规则', '高尔夫健身', '明星挥杆分析'],
      新闻赛事: ['高尔夫每月新闻', '高尔夫新闻', '高尔夫比赛介绍', '高尔夫人物介绍'],
      装备测评: ['高尔夫装备和品牌', '高尔夫开箱测评'],
      '旅行 Vlog': ['下场打球', '高尔夫旅行', '高尔夫球场介绍'],
      升学: ['高尔夫升学'],
      娱乐: ['高尔夫搞笑', '高尔夫技巧秀'],
    };
    const grades = ['老鹰', '小鸟', '标准杆', '柏忌', '双柏忌'];
    const median = (xs) => {
      const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const now = channel.length ? new Date(channel[0].fetchedAt) : new Date();
    const history = { long: [], short: [] };
    return [...videos]
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
      .map((v) => {
        const lists = v.playlists ? v.playlists.split('、') : [];
        const pillar = Object.keys(pillars).find((p) => lists.some((t) => pillars[p].some((pre) => t.startsWith(pre)))) || '未分类';
        const prior = history[v.type].slice(-10);
        history[v.type].push(v.views);
        const par = prior.length ? median(prior) : null;
        const vsPar = par ? Math.round((v.views / par) * 100) / 100 : null;
        const strokes = vsPar == null ? null : vsPar >= 2 ? -2 : vsPar >= 1.25 ? -1 : vsPar >= 0.8 ? 0 : vsPar >= 0.5 ? 1 : 2;
        const ageDays = Math.max((now - new Date(v.publishedAt)) / 864e5, 0.5);
        return {
          id: v.id, title: v.title, publishedAt: v.publishedAt, type: v.type, durationSec: v.durationSec,
          views: v.views, likes: v.likes, comments: v.comments, pillar,
          engagement: v.views ? (v.likes + v.comments) / v.views : 0,
          ageDays: Math.round(ageDays * 100) / 100,
          viewsPerDay: Math.round(v.views / ageDays),
          fresh: ageDays < 7,
          par, vsPar, strokes,
          grade: strokes == null ? '首支' : grades[strokes + 2],
        };
      });
  },
});

dash.calc('kpis', {
  title: '核心指标',
  description: '长视频与 Shorts 的数量和播放中位数、长视频互动率中位数，近 90 天对比此前 90 天的长视频播放中位数，以及近半年对比此前半年的发布数。',
  inputs: ['scored'],
  fn: (scored) => {
    const median = (xs) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const longs = scored.filter((v) => v.type === 'long');
    const shorts = scored.filter((v) => v.type === 'short');
    const within = (vs, from, to) => vs.filter((v) => v.ageDays >= from && v.ageDays < to);
    const views = (vs) => median(vs.map((v) => v.views));
    const last90 = within(longs, 0, 90), prev90 = within(longs, 90, 180);
    const l90 = views(last90), p90 = views(prev90);
    return [{
      longVideos: longs.length,
      shortVideos: shorts.length,
      longMedianViews: views(longs),
      shortMedianViews: views(shorts),
      longEngagement: median(longs.map((v) => v.engagement)),
      last90LongVideos: last90.length,
      last90LongMedian: views(last90),
      prev90LongVideos: prev90.length,
      prev90LongMedian: views(prev90),
      last90Change: l90 != null && p90 ? l90 / p90 - 1 : null,
      last180Uploads: within(scored, 0, 180).length,
      prev180Uploads: within(scored, 180, 360).length,
    }];
  },
});

dash.calc('scorecard', {
  title: '最近 18 洞',
  description: '最近 18 支长视频，按播放相对标准杆记分：老鹰 −2、小鸟 −1、标准杆 0、柏忌 +1、双柏忌 +2。',
  inputs: ['scored'],
  fn: (scored) => scored
    .filter((v) => v.type === 'long' && v.strokes != null)
    .slice(-18)
    .map((v, i) => ({
      hole: i + 1, id: v.id, title: v.title, publishedAt: v.publishedAt, views: v.views,
      par: v.par, vsPar: v.vsPar, strokes: v.strokes, grade: v.grade, fresh: v.fresh,
    })),
});

dash.calc('round', {
  title: '最近 18 洞合计',
  description: '前九洞（OUT）、后九洞（IN）和全场（TOT）相对标准杆的杆数合计；发布不满 7 天的视频播放还在涨，不计分。',
  inputs: ['scorecard'],
  fn: (scorecard) => {
    const played = scorecard.filter((h) => !h.fresh);
    const sum = (hs) => hs.reduce((s, h) => s + h.strokes, 0);
    const count = (g) => played.filter((h) => h.grade === g).length;
    return [{
      out: sum(played.filter((h) => h.hole <= 9)),
      in: sum(played.filter((h) => h.hole > 9)),
      total: sum(played),
      holesPlayed: played.length,
      eagles: count('老鹰'), birdies: count('小鸟'), pars: count('标准杆'), bogeys: count('柏忌'), doubles: count('双柏忌'),
    }];
  },
});

dash.calc('grades', {
  title: '杆数分布',
  description: '长视频和 Shorts 各自有多少支落在老鹰、小鸟、标准杆、柏忌、双柏忌；发布不满 7 天的单独计为新发布，不计分。',
  inputs: ['scored'],
  fn: (scored) => ['long', 'short'].flatMap((type) => [
    ...['老鹰', '小鸟', '标准杆', '柏忌', '双柏忌'].map((grade) => ({
      type, grade, videos: scored.filter((v) => v.type === type && v.grade === grade && !v.fresh).length,
    })),
    { type, grade: '新发布', videos: scored.filter((v) => v.type === type && v.fresh).length },
  ]),
});

dash.calc('monthly', {
  title: '每月发布',
  description: '按发布月份（UTC）统计的长视频和 Shorts 数量，以及当月长视频播放中位数。',
  inputs: ['scored'],
  fn: (scored) => {
    const median = (xs) => {
      const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const key = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const first = scored[0].publishedAt.slice(0, 7), last = scored[scored.length - 1].publishedAt.slice(0, 7);
    const months = [];
    for (let [y, m] = first.split('-').map(Number); key(y, m) <= last; m === 12 ? (y += 1, m = 1) : (m += 1)) months.push(key(y, m));
    return months.map((month) => {
      const vs = scored.filter((v) => v.publishedAt.startsWith(month));
      const lv = vs.filter((v) => v.type === 'long').map((v) => v.views);
      return { month, long: lv.length, short: vs.length - lv.length, longMedianViews: lv.length ? median(lv) : null };
    });
  },
});

dash.calc('pillars', {
  title: '内容支柱',
  description: '每个内容支柱的视频数、发布占比、播放占比，以及长视频的播放中位数和互动率中位数。',
  inputs: ['scored'],
  fn: (scored) => {
    const median = (xs) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const totalViews = scored.reduce((s, v) => s + v.views, 0);
    return [...new Set(scored.map((v) => v.pillar))].map((pillar) => {
      const vs = scored.filter((v) => v.pillar === pillar), lv = vs.filter((v) => v.type === 'long');
      const views = vs.reduce((s, v) => s + v.views, 0);
      return {
        pillar, videos: vs.length, longVideos: lv.length, shortVideos: vs.length - lv.length, views,
        uploadShare: vs.length / scored.length, viewShare: views / totalViews,
        longMedianViews: median(lv.map((v) => v.views)), longEngagement: median(lv.map((v) => v.engagement)),
      };
    }).sort((a, b) => b.views - a.views);
  },
});

dash.calc('formats', {
  title: '长视频与 Shorts',
  description: '长视频和 Shorts 的数量、发布占比、播放占比、播放中位数和互动率中位数。',
  inputs: ['scored'],
  fn: (scored) => {
    const median = (xs) => {
      const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const totalViews = scored.reduce((s, v) => s + v.views, 0);
    return [['long', '长视频'], ['short', 'Shorts']].map(([type, format]) => {
      const vs = scored.filter((v) => v.type === type);
      const views = vs.reduce((s, v) => s + v.views, 0);
      return {
        format, videos: vs.length, uploadShare: vs.length / scored.length, views, viewShare: views / totalViews,
        medianViews: median(vs.map((v) => v.views)), medianEngagement: median(vs.map((v) => v.engagement)),
      };
    });
  },
});

dash.calc('durations', {
  title: '时长与播放',
  description: '长视频按时长分组后的视频数和播放中位数。',
  inputs: ['scored'],
  fn: (scored) => {
    const median = (xs) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const longs = scored.filter((v) => v.type === 'long');
    return [[0, 5, '5 分钟内'], [5, 10, '5–10'], [10, 15, '10–15'], [15, 20, '15–20'], [20, 30, '20–30'], [30, 1e9, '30 分钟以上']]
      .map(([lo, hi, bucket]) => {
        const vs = longs.filter((v) => v.durationSec >= lo * 60 && v.durationSec < hi * 60);
        return { bucket, videos: vs.length, medianViews: median(vs.map((v) => v.views)) };
      });
  },
});

/* ======================= helpers ======================= */

const $ = (s) => document.querySelector(s);
const fmtInt = d3.format(',');
const pct = d3.format('.1%');
const trim = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
const wan = (n) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '', a = Math.round(Math.abs(n));
  if (a < 1e4) return sign + fmtInt(a);
  const r = Number(a.toPrecision(3));
  if (r >= 1e8) return sign + trim((r / 1e8).toFixed(2)) + '亿';
  return sign + trim((r / 1e4).toFixed(r >= 1e6 ? 0 : r >= 1e5 ? 1 : 2)) + '万';
};
const int = (n) => (n == null || !Number.isFinite(n) ? '—' : fmtInt(Math.round(n)));
const times = (r) => (r == null ? '—' : (r >= 10 ? String(Math.round(r)) : trim(r.toFixed(2))) + '×');
const bei = (r) => (r == null ? '—' : `${r >= 10 ? Math.round(r) : trim(r.toFixed(2))} 倍`);
const signedPct = (x) => {
  if (x == null || !Number.isFinite(x)) return '—';
  const r = Math.round(x * 100);
  return `${r >= 0 ? '+' : '−'}${Math.abs(r)}%`;
};
const strokesFmt = (s) => (s == null ? '—' : s === 0 ? 'E' : s > 0 ? `+${s}` : `−${Math.abs(s)}`);
const bjDate = (iso) => new Date(Date.parse(iso) + 8 * 36e5).toISOString().slice(0, 10);
const bjTime = (iso) => new Date(Date.parse(iso) + 8 * 36e5).toISOString().slice(0, 16).replace('T', ' ');
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (m < 48 * 60) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
};
const pad = (n) => String(n).padStart(2, '0');
const dur = (s) => {
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
};
const ytUrl = (id, type) => (type === 'short' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`);
const GRADE = {
  老鹰: { key: 'eagle', rule: '≥ 2×' },
  小鸟: { key: 'birdie', rule: '1.25–2×' },
  标准杆: { key: 'par', rule: '0.8–1.25×' },
  柏忌: { key: 'bogey', rule: '0.5–0.8×' },
  双柏忌: { key: 'double', rule: '< 0.5×' },
  首支: { key: 'none', rule: '' },
  新发布: { key: 'fresh', rule: '不满 7 天' },
};
const gradeKey = (g) => (GRADE[g] || GRADE.首支).key;

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
};
const enc = (v) => String(v).replace(/[%&=]/g, (c) => encodeURIComponent(c));
/* Marks: src('kpis', 'longVideos', 0) → one row by index; src('advice', 'title', {id: 'r1'}) → rows by value. */
const src = (source, field, where) => {
  const a = { 'data-source': source };
  if (field) a['data-field'] = field;
  if (typeof where === 'number') a['data-row'] = String(where);
  else if (where) a['data-where'] = Object.entries(where).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
  return a;
};
const rows = (id) => {
  const d = dash.data(id);
  return d.status === 'ok' ? (Array.isArray(d.data) ? d.data : d.rows || []) : null;
};
const status = (ids) => {
  const ss = ids.map((id) => dash.data(id).status);
  if (ss.every((s) => s === 'ok')) return 'ok';
  if (ss.some((s) => s === 'loading')) return 'loading';
  if (ss.some((s) => s === 'missing')) return 'missing';
  return 'error';
};
const failed = (box) => box.replaceChildren(h('div', { class: 'lx-failed', text: '加载失败' }));
/* Draw one block; keep the rest of the page alive if it throws, but still report the error. */
const block = (box, ids, draw) => {
  if (!box) return;
  const s = status(ids);
  box.classList.toggle('dash-skeleton', s === 'loading');
  if (s === 'loading') { box.replaceChildren(); return; }
  if (s === 'error') { failed(box); return; }
  if (s === 'missing') { box.replaceChildren(h('div', { class: 'lx-failed lx-empty', text: '暂无数据' })); return; }
  try { draw(); } catch (e) { failed(box); queueMicrotask(() => { throw e; }); }
};
let THUMBS = new Map();

/* Tooltip inside a position:relative box. */
const tipFor = (box) => {
  let tip = box.querySelector(':scope > .lx-tip');
  if (!tip) { tip = h('div', { class: 'lx-tip', role: 'tooltip' }); tip.hidden = true; box.append(tip); }
  return {
    show(nodes, x, y) {
      tip.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
      tip.hidden = false;
      const bw = box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = x + 14;
      if (left + tw > bw) left = Math.max(0, x - tw - 14);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, Math.min(y - th / 2, box.clientHeight - th))}px`;
    },
    hide() { tip.hidden = true; },
  };
};
const svgIn = (box, W, H, label) => d3.select(box).append('svg')
  .attr('class', 'lx-svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
  .attr('role', 'img').attr('aria-label', label);
const textWidth = (svg, strings) => {
  const t = svg.append('text');
  const w = d3.max(strings, (s) => { t.text(s); return t.node().getComputedTextLength(); }) || 0;
  t.remove();
  return w;
};
const videoTip = (v) => [
  THUMBS.get(v.id) ? h('img', { src: THUMBS.get(v.id), alt: '', referrerpolicy: 'no-referrer' }) : null,
  h('div', { class: 't', text: v.title }),
  h('div', { class: 'k', text: `${bjDate(v.publishedAt)} 发布${v.fresh ? ' · 不满 7 天' : ''}` }),
  h('div', { class: 'row' }, `播放 ${fmtInt(v.views)}`),
  v.par != null ? h('div', { class: 'row' }, h('span', { class: `lx-pill g-${gradeKey(v.grade)}${v.fresh ? ' fresh' : ''}`, text: v.fresh ? '新发布' : v.grade }), `播放是标准杆的 ${bei(v.vsPar)}`) : h('div', { class: 'k', text: '该格式第一支视频，没有标准杆' }),
  v.par != null ? h('div', { class: 'k', text: `标准杆 ${wan(v.par)}（此前 10 支中位数）` }) : null,
];

/* ======================= sections ======================= */

const FMT = { wan, int, pct: (v) => pct(v), delta: signedPct, date: (v) => String(v).slice(0, 10), bjdate: (v) => bjDate(v), bjtime: (v) => bjTime(v), ago, text: (v) => String(v) };
function drawStatic() {
  document.querySelectorAll('.lx [data-fmt]').forEach((el) => {
    const d = dash.data(el.dataset.source);
    el.classList.toggle('dash-skeleton', d.status === 'loading');
    if (d.status !== 'ok') { el.textContent = d.status === 'loading' ? '' : '—'; return; }
    const row = (Array.isArray(d.data) ? d.data : [])[Number(el.dataset.row || 0)];
    const v = row ? row[el.dataset.field] : null;
    el.textContent = v == null ? '—' : FMT[el.dataset.fmt](v);
    if (el.dataset.fmt === 'delta') { const r = Math.round(v * 100); el.classList.toggle('up', r > 0); el.classList.toggle('down', r < 0); }
  });
}

function drawHero() {
  const d = dash.data('channel');
  const banner = $('.lx-banner'), avatar = $('.lx-avatar-slot');
  [banner, avatar].forEach((el) => el.classList.toggle('dash-skeleton', d.status === 'loading'));
  if (d.status !== 'ok') return;
  const c = d.data[0];
  if (!c) return;
  const put = (slot, url, alt) => {
    let img = slot.querySelector('img');
    if (!url) { slot.replaceChildren(); return; }
    if (!img) { img = h('img', { alt, referrerpolicy: 'no-referrer' }); slot.replaceChildren(img); }
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
  };
  put(banner, c.banner, '');
  put(avatar, c.avatar, `${c.title} 头像`);
}

function drawLede() {
  const el = $('#takeaway');
  const s = status(['kpis']);
  el.classList.toggle('dash-skeleton', s === 'loading');
  if (s !== 'ok') { el.replaceChildren(); return; }
  const k = rows('kpis')[0];
  const b = (field, text) => h('b', { ...src('kpis', field, 0), text });
  const up = k.last90Change != null && k.last90Change >= 0;
  const fewer = k.last180Uploads < k.prev180Uploads * 0.9;
  el.replaceChildren(
    '近 90 天发布的 ', b('last90LongVideos', fmtInt(k.last90LongVideos)), ' 支长视频，播放中位数 ', b('last90LongMedian', wan(k.last90LongMedian)),
    ...(k.last90Change == null ? ['。'] : [
      '，比此前 90 天（', b('prev90LongVideos', fmtInt(k.prev90LongVideos)), ' 支）的中位数', up ? '高 ' : '低 ',
      b('last90Change', d3.format('.0%')(Math.abs(k.last90Change))), '。']),
    '近半年发布 ', b('last180Uploads', fmtInt(k.last180Uploads)), ' 支视频，此前半年是 ', b('prev180Uploads', fmtInt(k.prev180Uploads)), ' 支',
    fewer ? (up ? '：单支更能打了，但上场次数少了。' : '：更新变少，单支表现也在走低。') : '。',
  );
}

function symbol(x) {
  const key = x.fresh ? 'fresh' : gradeKey(x.grade);
  return h('span', {
    class: `lx-sym ${key}`,
    ...src('scorecard', 'vsPar', { hole: x.hole }),
    title: x.fresh ? '发布不满 7 天，播放还在涨，不计分' : `${x.grade}：播放是标准杆的 ${bei(x.vsPar)}`,
    text: times(x.vsPar),
  });
}

function drawScorecard() {
  const box = $('#scorecard-box'), summary = $('#round-summary');
  block(summary, ['round'], () => {
    const r = rows('round')[0];
    const b = (field, text) => h('b', { ...src('round', field, 0), text });
    summary.replaceChildren(
      h('span', { class: `lx-round-score ${r.total < 0 ? 'under' : r.total > 0 ? 'over' : ''}`, ...src('round', 'total', 0), text: strokesFmt(r.total) }),
      h('span', { class: 'lx-round-label' },
        h('span', {}, b('holesPlayed', fmtInt(r.holesPlayed)), ' 洞计分', r.total < 0 ? `，低于标准杆 ${Math.abs(r.total)} 杆` : r.total > 0 ? `，高于标准杆 ${r.total} 杆` : '，打平标准杆'),
        h('span', {}, '老鹰 ', b('eagles', r.eagles), ' · 小鸟 ', b('birdies', r.birdies), ' · 标准杆 ', b('pars', r.pars), ' · 柏忌 ', b('bogeys', r.bogeys), ' · 双柏忌 ', b('doubles', r.doubles))),
    );
  });
  block(box, ['scorecard', 'round', 'videos'], () => {
    const holes = rows('scorecard'), r = rows('round')[0];
    const cols = [
      ...holes.filter((x) => x.hole <= 9).map((x) => ({ x })), { total: 'out', label: 'OUT' },
      ...holes.filter((x) => x.hole > 9).map((x) => ({ x })), { total: 'in', label: 'IN' }, { total: 'total', label: 'TOT' },
    ];
    const at = (x) => ({ hole: x.hole });
    const lines = [
      ['视频', (c) => c.x && h('a', { class: 'lx-sc-thumb', href: ytUrl(c.x.id, 'long'), target: '_blank', rel: 'noopener', title: c.x.title, 'aria-label': c.x.title }, h('img', { src: THUMBS.get(c.x.id) || '', alt: '', referrerpolicy: 'no-referrer' }))],
      ['发布', (c) => c.x && h('span', { ...src('scorecard', 'publishedAt', at(c.x)), text: bjDate(c.x.publishedAt).slice(5) })],
      ['播放', (c) => c.x && h('span', { ...src('scorecard', 'views', at(c.x)), text: wan(c.x.views) })],
      ['标准杆', (c) => c.x && h('span', { ...src('scorecard', 'par', at(c.x)), text: wan(c.x.par) })],
      ['成绩', (c) => (c.x ? symbol(c.x) : h('span', { class: 'lx-sc-total', ...src('round', c.total, 0), text: strokesFmt(r[c.total]) }))],
    ];
    const table = h('table', { class: 'lx-sc' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: '洞' }), cols.map((c) => h('th', { scope: 'col', class: c.total ? 'sum' : null, text: c.x ? c.x.hole : c.label })))),
      h('tbody', {}, lines.map(([label, cell]) => h('tr', {}, h('th', { scope: 'row', text: label }), cols.map((c) => h('td', { class: c.total ? 'sum' : null }, cell(c)))))));
    box.replaceChildren(h('div', { class: 'lx-sc-wrap' }, table));
    const tip = tipFor(box);
    box.querySelectorAll('.lx-sc-thumb').forEach((a, i) => {
      const x = holes[i];
      a.addEventListener('pointerenter', () => {
        const r0 = a.getBoundingClientRect(), rb = box.getBoundingClientRect();
        tip.show(videoTip(x), r0.right - rb.left, r0.top - rb.top + 60);
      });
      a.addEventListener('pointerleave', () => tip.hide());
    });
  });
}

function drawCaddie() {
  const lead = $('#caddie-lead'), sw = $('#caddie-sw'), recs = $('#caddie-recs'), ideas = $('#caddie-ideas');
  block(lead, ['diagnosis'], () => {
    const d = rows('diagnosis').filter((x) => x.kind === '总结');
    lead.replaceChildren(...d.map((x) => h('p', { class: 'lx-lead', ...src('diagnosis', 'text', { id: x.id }), text: x.text })));
  });
  block(sw, ['diagnosis'], () => {
    const d = rows('diagnosis');
    const list = (kind, title, cls) => h('div', { class: 'lx-card' },
      h('h3', { text: title }),
      h('ul', { class: `lx-list ${cls}` }, d.filter((x) => x.kind === kind).map((x) => h('li', {}, h('span', { ...src('diagnosis', 'text', { id: x.id }), text: x.text })))));
    sw.replaceChildren(list('优势', '打得好的地方', 'good'), list('注意', '需要留意的地方', 'warn'));
  });
  block(recs, ['advice'], () => {
    recs.replaceChildren(...rows('advice').map((r, i) => {
      const w = { id: r.id };
      return h('article', { class: 'lx-rec', id: `rec-${r.id}` },
        h('div', { class: 'lx-rec-top' },
          h('span', { class: 'lx-rec-no', text: pad(i + 1) }),
          h('span', { class: 'lx-chips' },
            h('span', { class: `lx-chip${r.impact === '高' ? ' hi' : ''}` }, '影响 ', h('b', { ...src('advice', 'impact', w), text: r.impact })),
            h('span', { class: 'lx-chip' }, '投入 ', h('b', { ...src('advice', 'effort', w), text: r.effort })))),
        h('h3', { ...src('advice', 'title', w), text: r.title }),
        h('p', { class: 'lx-rec-why', ...src('advice', 'why', w), text: r.why }),
        h('div', { class: 'lx-rec-act' }, h('span', { class: 'lx-rec-label', text: '这个月就做' }), h('p', { ...src('advice', 'action', w), text: r.action })),
        h('details', { class: 'lx-more' }, h('summary', { text: '看依据' }), h('p', { class: 'lx-note', ...src('advice', 'evidence', w), text: r.evidence })));
    }));
  });
  block(ideas, ['ideas'], () => {
    ideas.replaceChildren(...rows('ideas').map((x) => {
      const w = { id: x.id };
      return h('div', { class: 'lx-idea' },
        h('div', { class: 'lx-idea-title', ...src('ideas', 'title', w), text: x.title }),
        h('p', { ...src('ideas', 'rationale', w), text: x.rationale }),
        h('p', { class: 'lx-idea-based' }, '依据：', h('span', { ...src('ideas', 'basedOn', w), text: x.basedOn })));
    }));
  });
}

let trackerType = 'long';
function drawTracker() {
  const box = $('#tracker-box'), legend = $('#tracker-legend');
  document.querySelectorAll('#tracker-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === trackerType)));
  block(legend, ['grades'], () => {
    const g = rows('grades').filter((x) => x.type === trackerType);
    legend.replaceChildren(
      ...g.filter((x) => x.grade !== '新发布' || x.videos).map((x) => h('span', {}, h('span', { class: `lx-sw g-${gradeKey(x.grade)}` }), `${x.grade} ${GRADE[x.grade].rule}`, h('b', { ...src('grades', 'videos', { type: x.type, grade: x.grade }), text: fmtInt(x.videos) }))),
      h('span', {}, h('span', { class: 'lx-sw line' }), '标准杆（前 10 支中位数）'),
    );
  });
  block(box, ['scored', 'videos'], () => {
    box.replaceChildren();
    const data = rows('scored').filter((v) => v.type === trackerType);
    const W = Math.max(box.clientWidth, 280), H = W < 560 ? 300 : 380;
    const small = W < 560;
    const yMin = Math.max(1, d3.min(data, (d) => d.views) * 0.7), yMax = d3.max(data, (d) => d.views) * 1.35;
    const svg = svgIn(box, W, H, trackerType === 'long' ? '每支长视频的播放和标准杆' : '每支 Shorts 的播放和标准杆');
    const ticks = [10, 100, 1e3, 1e4, 1e5, 1e6].filter((t) => t >= yMin && t <= yMax);
    const m = { t: 14, r: 12, b: 28, l: textWidth(svg, ticks.map(wan)) + 12 };
    const y = d3.scaleLog([yMin, yMax], [H - m.b, m.t]);
    const dates = data.map((d) => new Date(d.publishedAt));
    const x = d3.scaleUtc(d3.extent(dates), [m.l + 8, W - m.r - 8]);
    const gGrid = svg.append('g');
    ticks.forEach((t) => {
      gGrid.append('line').attr('class', 'grid').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t));
      gGrid.append('text').attr('x', m.l - 8).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(wan(t));
    });
    svg.append('line').attr('class', 'axis').attr('x1', m.l).attr('x2', W - m.r).attr('y1', H - m.b).attr('y2', H - m.b);
    let lastX = -Infinity;
    d3.utcYear.range(d3.utcYear.ceil(x.domain()[0]), x.domain()[1]).forEach((yr) => {
      const px = x(yr);
      if (px - lastX < 40) return;
      lastX = px;
      svg.append('line').attr('class', 'axis').attr('x1', px).attr('x2', px).attr('y1', H - m.b).attr('y2', H - m.b + 4);
      svg.append('text').attr('x', px).attr('y', H - 8).attr('text-anchor', 'middle').text(d3.utcFormat('%Y')(yr));
    });
    const parLine = d3.line().defined((d) => d.par != null).x((d) => x(new Date(d.publishedAt))).y((d) => y(Math.max(d.par, yMin))).curve(d3.curveStepAfter);
    svg.append('path').attr('class', 'parline').attr('d', parLine(data));
    const r = small ? 3.5 : 4.5;
    const pts = data.map((d) => [x(new Date(d.publishedAt)), y(Math.max(d.views, yMin))]);
    const dots = svg.append('g').selectAll('a').data(data).join('a')
      .attr('href', (d) => ytUrl(d.id, d.type)).attr('target', '_blank').attr('rel', 'noopener').attr('aria-label', (d) => d.title)
      .append('circle')
      .attr('class', (d) => `dot g-${gradeKey(d.grade)}${d.fresh ? ' fresh' : ''}`)
      .attr('cx', (d, i) => pts[i][0]).attr('cy', (d, i) => pts[i][1]).attr('r', r);
    const delaunay = d3.Delaunay.from(pts);
    const tip = tipFor(box);
    let on = -1;
    const scale = () => box.clientWidth / W;
    svg.on('pointermove', (event) => {
      const [px, py] = d3.pointer(event);
      const i = delaunay.find(px, py);
      if (i < 0 || Math.hypot(pts[i][0] - px, pts[i][1] - py) > 28) { leave(); return; }
      if (i !== on) {
        dots.classed('on', (d, j) => j === i).attr('r', (d, j) => (j === i ? r + 2.5 : r));
        on = i;
      }
      tip.show(videoTip(data[i]), pts[i][0] * scale(), pts[i][1] * scale());
    });
    const leave = () => { on = -1; dots.classed('on', false).attr('r', r); tip.hide(); };
    svg.on('pointerleave', leave);
  });
}

function drawMonthly() {
  const box = $('#monthly-box');
  block(box, ['monthly'], () => {
    box.replaceChildren();
    const ms = rows('monthly');
    const W = Math.max(box.clientWidth, 280), H = 230;
    const svg = svgIn(box, W, H, '每月发布的长视频和 Shorts 数量');
    const yMax = d3.max(ms, (d) => d.long + d.short) || 1;
    const y0 = d3.scaleLinear([0, yMax], [H - 26, 10]).nice();
    const ticks = y0.ticks(4).filter(Number.isInteger);
    const m = { t: 10, r: 6, b: 26, l: textWidth(svg, ticks.map(String)) + 10 };
    const y = d3.scaleLinear(y0.domain(), [H - m.b, m.t]);
    const x = d3.scaleBand(ms.map((d) => d.month), [m.l, W - m.r]).paddingInner(0.22).paddingOuter(0.1);
    ticks.forEach((t) => {
      svg.append('line').attr('class', 'grid').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t));
      svg.append('text').attr('x', m.l - 6).attr('y', y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text(t);
    });
    let lastX = -Infinity;
    ms.forEach((d, i) => {
      if (!(d.month.endsWith('-01') || i === 0)) return;
      const px = x(d.month) + x.bandwidth() / 2;
      if (px - lastX < 36) return;
      lastX = px;
      svg.append('text').attr('x', px).attr('y', H - 8).attr('text-anchor', 'middle').text(d.month.slice(0, 4));
    });
    const bw = x.bandwidth(), rx = Math.min(2, bw / 2);
    const g = svg.append('g');
    ms.forEach((d) => {
      const x0 = x(d.month);
      if (d.long) g.append('rect').attr('class', 'bar s-long').attr('x', x0).attr('width', bw).attr('y', y(d.long)).attr('height', y(0) - y(d.long)).attr('rx', rx);
      if (d.short) {
        const top = y(d.long + d.short), bottom = y(d.long) - (d.long ? 2 : 0);
        if (bottom - top > 0.5) g.append('rect').attr('class', 'bar s-short').attr('x', x0).attr('width', bw).attr('y', top).attr('height', bottom - top).attr('rx', rx);
      }
    });
    svg.append('line').attr('class', 'axis').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0));
    const tip = tipFor(box);
    const scale = () => box.clientWidth / W;
    svg.append('g').selectAll('rect').data(ms).join('rect').attr('class', 'hit')
      .attr('x', (d) => x(d.month) - (x.step() - bw) / 2).attr('width', x.step()).attr('y', m.t).attr('height', H - m.t - m.b)
      .on('pointerenter', (event, d) => {
        g.selectAll('rect').classed('dim', function () { return Number(this.getAttribute('x')) !== x(d.month); });
        tip.show([
          h('div', { class: 'k', text: `${d.month.slice(0, 4)} 年 ${Number(d.month.slice(5))} 月` }),
          h('div', { class: 'row' }, h('span', { class: 'lx-sw sq s-long' }), `长视频 ${d.long} 支`),
          h('div', { class: 'row' }, h('span', { class: 'lx-sw sq s-short' }), `Shorts ${d.short} 支`),
          d.longMedianViews != null ? h('div', { class: 'k', text: `长视频播放中位数 ${wan(d.longMedianViews)}` }) : null,
        ], (x(d.month) + bw / 2) * scale(), y(d.long + d.short) * scale());
      })
      .on('pointerleave', () => { g.selectAll('rect').classed('dim', false); tip.hide(); });
  });
}

function drawDurations() {
  const box = $('#durations-box');
  block(box, ['durations'], () => {
    box.replaceChildren();
    const ds = rows('durations');
    const W = Math.max(box.clientWidth, 280), H = 230, m = { t: 22, r: 4, b: 42, l: 4 };
    const svg = svgIn(box, W, H, '长视频按时长分组的播放中位数');
    const x = d3.scaleBand(ds.map((d) => d.bucket), [m.l, W - m.r]).paddingInner(0.28).paddingOuter(0.08);
    const y = d3.scaleLinear([0, (d3.max(ds, (d) => d.medianViews) || 1) * 1.08], [H - m.b, m.t]);
    const bw = Math.min(x.bandwidth(), 56), off = (x.bandwidth() - bw) / 2;
    const g = svg.append('g');
    ds.forEach((d) => {
      const x0 = x(d.bucket) + off, v = d.medianViews || 0;
      g.append('rect').attr('class', 'bar g-eagle').attr('x', x0).attr('width', bw).attr('y', y(v)).attr('height', Math.max(0, y(0) - y(v))).attr('rx', 4);
      svg.append('text').attr('class', 'val').attr('x', x0 + bw / 2).attr('y', y(v) - 6).attr('text-anchor', 'middle').text(d.medianViews == null ? '—' : wan(d.medianViews));
      svg.append('text').attr('x', x0 + bw / 2).attr('y', H - m.b + 16).attr('text-anchor', 'middle').text(d.bucket);
      svg.append('text').attr('x', x0 + bw / 2).attr('y', H - m.b + 31).attr('text-anchor', 'middle').text(`${d.videos} 支`);
    });
    svg.append('line').attr('class', 'axis').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0));
    const tip = tipFor(box);
    const scale = () => box.clientWidth / W;
    svg.append('g').selectAll('rect').data(ds).join('rect').attr('class', 'hit')
      .attr('x', (d) => x(d.bucket)).attr('width', x.bandwidth()).attr('y', m.t).attr('height', H - m.t - m.b)
      .on('pointerenter', (event, d) => tip.show([
        h('div', { class: 'k', text: d.bucket === '5 分钟内' || d.bucket === '30 分钟以上' ? d.bucket : `${d.bucket} 分钟` }),
        h('div', { class: 'row', text: `播放中位数 ${int(d.medianViews)}` }),
        h('div', { class: 'row', text: `${d.videos} 支长视频` }),
      ], (x(d.bucket) + x.bandwidth() / 2) * scale(), y(d.medianViews || 0) * scale()))
      .on('pointerleave', () => tip.hide());
  });
}

/* A table drawn from rows, marked once: data-source + data-row-key on the table, data-field on each th. */
const table = (source, key, cols, data, opts = {}) => h('table', { class: 'lx-table', 'data-source': source, 'data-row-key': key },
  h('thead', {}, h('tr', {}, cols.map((c) => h('th', {
    scope: 'col', class: [c.cls, c.hide ? 'lx-hide-sm' : ''].filter(Boolean).join(' ') || null,
    'data-field': c.field, 'data-source': c.source || null,
    'aria-sort': opts.sort && opts.sort.field === c.field ? (opts.sort.dir > 0 ? 'ascending' : 'descending') : null,
  }, opts.onSort && c.sortable !== false ? h('button', { type: 'button', 'data-sort': c.field, text: c.label }) : c.label)))),
  h('tbody', {}, data.map((d) => h('tr', { 'data-key': d[key] }, cols.map((c) => h('td', { class: [c.cls, c.hide ? 'lx-hide-sm' : ''].filter(Boolean).join(' ') || null }, c.cell(d)))))));
const cellBar = (v, max, label, tone = '') => h('div', { class: 'lx-cellbar' },
  h('div', { class: 'lx-track' }, h('span', { class: `lx-fill ${tone}`, style: `width:${max ? Math.max(0, Math.min(1, v / max)) * 100 : 0}%` })),
  h('span', { text: label }));

function drawPillars() {
  const box = $('#pillars-box');
  block(box, ['pillars'], () => {
    const ps = rows('pillars');
    const maxShare = d3.max(ps, (p) => Math.max(p.uploadShare, p.viewShare));
    const maxMed = d3.max(ps, (p) => p.longMedianViews || 0);
    box.replaceChildren(h('div', { class: 'lx-tablebox' }, table('pillars', 'pillar', [
      { field: 'pillar', label: '内容支柱', cls: 't', cell: (p) => p.pillar },
      { field: 'videos', label: '视频', cell: (p) => fmtInt(p.videos) },
      { field: 'uploadShare', label: '发布占比', cell: (p) => cellBar(p.uploadShare, maxShare, pct(p.uploadShare), 'muted') },
      { field: 'viewShare', label: '播放占比', cell: (p) => cellBar(p.viewShare, maxShare, pct(p.viewShare)) },
      { field: 'longMedianViews', label: '长视频播放中位数', cell: (p) => cellBar(p.longMedianViews || 0, maxMed, int(p.longMedianViews)) },
      { field: 'longEngagement', label: '长视频互动率', hide: true, cell: (p) => (p.longEngagement == null ? '—' : pct(p.longEngagement)) },
    ], ps)));
  });
}

function drawFormats() {
  const box = $('#formats-box');
  block(box, ['formats'], () => {
    const fs = rows('formats');
    box.replaceChildren(h('div', { class: 'lx-tablebox' }, table('formats', 'format', [
      { field: 'format', label: '格式', cls: 't', cell: (f) => f.format },
      { field: 'videos', label: '视频', cell: (f) => fmtInt(f.videos) },
      { field: 'uploadShare', label: '发布占比', hide: true, cell: (f) => pct(f.uploadShare) },
      { field: 'viewShare', label: '播放占比', cell: (f) => cellBar(f.viewShare, 1, pct(f.viewShare), f.format === 'Shorts' ? 'short' : 'long') },
      { field: 'medianViews', label: '播放中位数', cell: (f) => int(f.medianViews) },
      { field: 'medianEngagement', label: '互动率', cell: (f) => pct(f.medianEngagement) },
    ], fs)));
  });
}

function drawSeries() {
  const box = $('#series-box');
  block(box, ['series'], () => {
    const ss = [...rows('series')].sort((a, b) => b.totalViews - a.totalViews);
    const max = d3.max(ss, (s) => s.medianViews || 0);
    box.replaceChildren(h('div', { class: 'lx-tablebox mid' }, table('series', 'name', [
      { field: 'name', label: '系列', cls: 't', cell: (s) => s.name },
      { field: 'count', label: '支数', cell: (s) => fmtInt(s.count) },
      { field: 'medianViews', label: '播放中位数', cell: (s) => cellBar(s.medianViews || 0, max, int(s.medianViews)) },
      { field: 'totalViews', label: '总播放', cell: (s) => fmtInt(s.totalViews) },
    ], ss)));
    box.querySelectorAll('tbody tr').forEach((tr, i) => { tr.title = ss[i].note || ''; });
  });
}

function drawFindings() {
  const box = $('#findings-box');
  block(box, ['findings'], () => {
    const conf = { high: '高', medium: '中', low: '低' };
    box.replaceChildren(...rows('findings').map((f) => {
      const w = { id: f.id };
      return h('article', { class: 'lx-card lx-finding' },
        h('span', { class: 'lx-conf' }, '把握 ', h('b', { ...src('findings', 'confidence', w), text: conf[f.confidence] || f.confidence })),
        h('h3', { ...src('findings', 'headline', w), text: f.headline }),
        h('p', { ...src('findings', 'detail', w), text: f.detail }),
        f.evidence ? h('details', { class: 'lx-more' }, h('summary', { text: '看证据' }), h('div', { class: 'lx-ev' }, h('span', { ...src('findings', 'evidence', w), text: f.evidence }))) : null);
    }));
  });
}

function drawAudience() {
  const themes = $('#themes-box'), asks = $('#asks-box'), profile = $('#profile-box');
  block(themes, ['audience'], () => {
    const a = rows('audience');
    const ts = a.filter((x) => x.kind === '主题').sort((p, q) => q.count - p.count);
    const mood = a.filter((x) => x.kind === '情绪');
    const max = d3.max(ts, (t) => t.count) || 1;
    const total = d3.sum(mood, (x) => x.count) || 1;
    const cls = { 正面: 'pos', 中性: 'neu', 负面: 'neg' };
    themes.replaceChildren(
      h('div', { class: 'lx-themes' }, ts.map((t) => h('div', { class: 'lx-theme' },
        h('div', { class: 'lx-theme-top' },
          h('span', { class: 'lx-theme-name', ...src('audience', 'name', { id: t.id }), text: t.name }),
          h('div', { class: 'lx-track' }, h('span', { class: 'lx-fill', style: `width:${(t.count / max) * 100}%` })),
          h('span', { class: 'lx-count', ...src('audience', 'count', { id: t.id }), text: fmtInt(t.count) })),
        t.text ? h('p', { class: 'lx-theme-sum', ...src('audience', 'text', { id: t.id }), text: t.text }) : null,
        t.quote ? h('p', { class: 'lx-theme-sum' }, '“', h('span', { ...src('audience', 'quote', { id: t.id }), text: t.quote }), '”') : null))),
      mood.length ? h('div', { class: 'lx-mood-wrap', style: 'display:grid;gap:6px;margin-top:6px' },
        h('div', { class: 'lx-mood', role: 'img', 'aria-label': '评论情绪分布' }, mood.map((x) => h('span', { class: cls[x.name] || 'neu', style: `flex:${x.count / total} 1 0` }))),
        h('div', { class: 'lx-legend' }, mood.map((x) => h('span', {}, h('span', { class: `lx-sw ${x.name === '正面' ? 'g-eagle' : x.name === '负面' ? 'g-bogey' : 'g-par'}` }), h('span', { ...src('audience', 'name', { id: x.id }), text: x.name }), h('b', { ...src('audience', 'count', { id: x.id }), text: fmtInt(x.count) }))))) : null,
    );
  });
  block(asks, ['audience'], () => {
    const a = rows('audience');
    const list = (kind, title) => {
      const items = a.filter((x) => x.kind === kind).sort((p, q) => q.count - p.count);
      return h('div', { class: 'lx-card' },
        h('h3', { text: title }),
        h('div', { class: 'lx-asks' }, items.map((x) => h('div', { class: 'lx-ask' },
          h('span', { class: 'lx-ask-text', ...src('audience', 'name', { id: x.id }), text: x.name }),
          h('span', { class: 'lx-count' }, h('span', { ...src('audience', 'count', { id: x.id }), text: fmtInt(x.count) }), ' 次'),
          x.text ? h('span', { class: 'lx-ask-ev', ...src('audience', 'text', { id: x.id }), text: x.text }) : null))));
    };
    asks.replaceChildren(list('请求', '观众想看的内容'), list('提问', '反复被问到的问题'));
  });
  block(profile, ['audience'], () => {
    const p = rows('audience').filter((x) => x.kind === '画像');
    profile.replaceChildren(...p.map((x) => h('p', { ...src('audience', 'text', { id: x.id }), text: x.text })));
  });
}

function drawQuotes() {
  const box = $('#quotes-box');
  block(box, ['comments'], () => {
    const cs = rows('comments').filter((c) => !c.isCreator).sort((a, b) => b.likes - a.likes).slice(0, 9);
    box.replaceChildren(...cs.map((c) => {
      const w = { commentId: c.commentId };
      return h('figure', { class: 'lx-quote' },
        h('blockquote', { ...src('comments', 'text', w), title: c.text, text: c.text }),
        h('figcaption', {},
          h('span', {}, h('b', { ...src('comments', 'likes', w), text: fmtInt(c.likes) }), ' 赞'),
          c.replies ? h('span', {}, '· ', h('b', { ...src('comments', 'replies', w), text: fmtInt(c.replies) }), ' 条回复') : null,
          h('span', { class: 'vt' }, '《', h('span', { ...src('comments', 'videoTitle', w), text: c.videoTitle }), '》')));
    }));
  });
}

function drawTitles() {
  const box = $('#titles-box'), take = $('#titles-take');
  block(take, ['diagnosis'], () => {
    const t = rows('diagnosis').filter((x) => x.kind === '标题结论');
    take.replaceChildren(...t.map((x) => h('p', { ...src('diagnosis', 'text', { id: x.id }), text: x.text })));
  });
  block(box, ['title_patterns'], () => {
    const ps = [...rows('title_patterns')].sort((a, b) => b.lift - a.lift);
    const lim = Math.log2(4);
    const lift = (v) => {
      const l = Math.max(-lim, Math.min(lim, Math.log2(v || 1)));
      return h('div', { class: 'lx-liftcell' }, h('span', { text: times(v) }),
        h('div', { class: 'lx-lift', 'aria-hidden': 'true' },
          h('span', { class: 'neg', style: `width:${l < 0 ? (-l / lim) * 100 : 0}%` }),
          h('span', { class: 'pos', style: `width:${l > 0 ? (l / lim) * 100 : 0}%` })));
    };
    box.replaceChildren(h('div', { class: 'lx-tablebox' }, table('title_patterns', 'id', [
      { field: 'pattern', label: '标题特征', cls: 't', cell: (p) => p.pattern },
      { field: 'nWith', label: '有此特征', cell: (p) => `${fmtInt(p.nWith)} 支` },
      { field: 'medianWith', label: '播放中位数（有）', cell: (p) => int(p.medianWith) },
      { field: 'medianWithout', label: '（无）', hide: true, cell: (p) => int(p.medianWithout) },
      { field: 'lift', label: '播放倍数', cell: (p) => lift(p.lift) },
      { field: 'verdict', label: '结论', cls: 'wrap', hide: true, cell: (p) => p.verdict },
    ], ps)));
  });
}

const lib = { q: '', type: 'all', pillar: 'all', sort: { field: 'publishedAt', dir: -1 }, focus: null };
function drawLibrary() {
  const box = $('#library-box'), count = $('#library-count'), sel = $('#lib-pillar');
  document.querySelectorAll('#lib-type button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === lib.type)));
  block(box, ['videos', 'scored'], () => {
    const vids = rows('videos'), sc = new Map(rows('scored').map((s) => [s.id, s]));
    const pillars = [...new Set(rows('scored').map((s) => s.pillar))];
    if (sel.options.length !== pillars.length + 1) sel.replaceChildren(new Option('全部内容支柱', 'all'), ...pillars.map((p) => new Option(p, p)));
    sel.value = lib.pillar;
    const q = lib.q.trim().toLowerCase();
    const data = vids.map((v) => ({ ...sc.get(v.id), ...v }))
      .filter((v) => (lib.type === 'all' || v.type === lib.type) && (lib.pillar === 'all' || v.pillar === lib.pillar) && (!q || v.title.toLowerCase().includes(q)));
    const { field, dir } = lib.sort;
    data.sort((a, b) => {
      const x = a[field], y = b[field];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
    const maxViews = d3.max(vids, (v) => v.views) || 1;
    const t = table('videos', 'id', [
      { field: 'title', label: '视频', cls: 't', cell: (v) => h('div', { class: 'lx-vid' }, h('img', { src: v.thumb || '', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), h('a', { href: ytUrl(v.id, v.type), target: '_blank', rel: 'noopener', text: v.title })) },
      { field: 'publishedAt', label: '发布', hide: true, cell: (v) => bjDate(v.publishedAt) },
      { field: 'type', label: '格式', hide: true, cell: (v) => (v.type === 'short' ? 'Shorts' : '长视频') },
      { field: 'pillar', source: 'scored', label: '支柱', hide: true, cell: (v) => v.pillar },
      { field: 'durationSec', label: '时长', hide: true, cell: (v) => dur(v.durationSec) },
      { field: 'views', label: '播放', cell: (v) => cellBar(v.views, maxViews, fmtInt(v.views)) },
      { field: 'likes', label: '点赞', hide: true, cell: (v) => fmtInt(v.likes) },
      { field: 'comments', label: '评论', hide: true, cell: (v) => fmtInt(v.comments) },
      { field: 'engagement', source: 'scored', label: '互动率', cell: (v) => pct(v.engagement) },
      { field: 'vsPar', source: 'scored', label: '对比标准杆', cell: (v) => (v.vsPar == null ? '—' : h('span', { class: `lx-pill g-${gradeKey(v.grade)}${v.fresh ? ' fresh' : ''}`, title: v.fresh ? `${v.grade} · 发布不满 7 天` : v.grade, text: times(v.vsPar) })) },
    ], data, { sort: lib.sort, onSort: true });
    t.querySelectorAll('th button').forEach((b) => b.addEventListener('click', () => {
      const f = b.dataset.sort;
      lib.sort = { field: f, dir: lib.sort.field === f ? -lib.sort.dir : f === 'title' ? 1 : -1 };
      lib.focus = f;
      drawLibrary();
    }));
    const old = box.querySelector('.lx-tablebox');
    const keep = old ? [old.scrollTop, old.scrollLeft] : [0, 0];
    const wrap = h('div', { class: 'lx-tablebox tall' }, t);
    box.replaceChildren(wrap);
    [wrap.scrollTop, wrap.scrollLeft] = keep;
    if (lib.focus) { const btn = t.querySelector(`th button[data-sort="${lib.focus}"]`); if (btn) btn.focus({ preventScroll: true }); lib.focus = null; }
    count.textContent = `显示 ${fmtInt(data.length)} / ${fmtInt(vids.length)} 支`;
  });
}

/* ======================= refresh ======================= */

/* The refresh button talks to tools/refresh_server.py on the owner's own computer. It is shown only in a
   browser that opened the site once with ?owner=1 (or on a local preview), so visitors never see it. */
const REFRESH_URL = 'http://127.0.0.1:8765/run';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};
(() => {
  const qs = new URLSearchParams(location.search);
  if (qs.get('owner') === '1') store.set('lx-owner', '1');
  if (qs.get('owner') === '0') store.set('lx-owner', null);
  const refreshed = qs.get('refreshed');
  if (qs.has('owner') || refreshed) {
    qs.delete('owner');
    qs.delete('refreshed');
    const q = qs.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  }
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const btn = $('#lx-refresh');
  btn.hidden = !(store.get('lx-owner') === '1' || local);
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = '正在连接本机…';
    // An <a> with referrerpolicy=unsafe-url sends this page's URL across the https→http hop,
    // which is how the local service knows the click came from the dashboard.
    const a = h('a', { href: `${REFRESH_URL}?next=${encodeURIComponent(location.origin + location.pathname)}`, referrerpolicy: 'unsafe-url' });
    document.body.append(a);
    a.click();
    a.remove();
  });
  window.addEventListener('pageshow', () => { btn.disabled = false; btn.textContent = '刷新数据'; });
  if (refreshed && !Number.isNaN(Date.parse(refreshed))) {
    const toast = $('#lx-toast');
    toast.textContent = `已刷新，数据截至 ${bjTime(refreshed)}（北京时间）`;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 6000);
  }
})();

/* ======================= wiring ======================= */

document.querySelectorAll('#tracker-seg button').forEach((b) => b.addEventListener('click', () => { trackerType = b.dataset.type; drawTracker(); }));
document.querySelectorAll('#lib-type button').forEach((b) => b.addEventListener('click', () => { lib.type = b.dataset.type; drawLibrary(); }));
$('#lib-q').addEventListener('input', (e) => { lib.q = e.target.value; drawLibrary(); });
$('#lib-pillar').addEventListener('change', (e) => { lib.pillar = e.target.value; drawLibrary(); });
document.querySelectorAll('.lx-nav a').forEach((a) => a.addEventListener('click', (e) => {
  const el = document.getElementById(a.getAttribute('href').slice(1));
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  dash.setLink(el.id);
}));

let linked = false;
dash.onData(() => {
  const v = rows('videos');
  if (v) THUMBS = new Map(v.map((x) => [x.id, x.thumb]));
  drawStatic();
  drawHero();
  drawLede();
  drawScorecard();
  drawCaddie();
  drawTracker();
  drawMonthly();
  drawDurations();
  drawPillars();
  drawFormats();
  drawSeries();
  drawFindings();
  drawAudience();
  drawQuotes();
  drawTitles();
  drawLibrary();
  if (!linked && v) {
    linked = true;
    const named = document.getElementById(location.hash.slice(1));
    if (named && named.closest('.lx')) requestAnimationFrame(() => named.scrollIntoView());
  }
});

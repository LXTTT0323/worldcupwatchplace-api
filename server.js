const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "127.0.0.1";
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const YELP_API_KEY = process.env.YELP_API_KEY || "";
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || "";
const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN || "";
const EVENTBRITE_PUBLIC_SEARCH_ENABLED = process.env.EVENTBRITE_PUBLIC_SEARCH_ENABLED === "1";
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";
const REDDIT_BEARER_TOKEN = process.env.REDDIT_BEARER_TOKEN || "";
const WORLD_CUP_DATA_URL = process.env.WORLD_CUP_DATA_URL || "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const SIGNALS_PATH = path.join(__dirname, "data", "signals.json");
const PLAN_EVENTS_PATH = path.join(__dirname, "data", "plan_events.json");
const SOCIAL_SIGNALS_PATH = path.join(__dirname, "data", "social_signals.json");
const USER_AGENT = "WorldCupWatchPlace/0.1 contact=local-prototype";

const memoryCache = {
  matches: null,
  matchesFetchedAt: 0,
  geocode: new Map(),
  timeZones: new Map(),
  routes: new Map(),
  externalSignals: new Map(),
  venues: new Map()
};

const CATEGORY_QUERIES = {
  all: [
    "sports bar",
    "pub showing soccer",
    "restaurant with sports tv",
    "bar with big screens",
    "watch party soccer"
  ],
  sports_bar: [
    "sports bar",
    "soccer pub",
    "bar with big screens",
    "pub showing soccer"
  ],
  restaurant: [
    "restaurant with sports tv",
    "restaurant bar big screen",
    "family restaurant sports tv",
    "restaurant showing soccer"
  ],
  chinese: [
    "chinese restaurant sports tv",
    "chinese bar soccer",
    "chinese restaurant big screen",
    "chinese restaurant showing soccer"
  ],
  italian: [
    "italian restaurant sports tv",
    "italian bar soccer",
    "italian restaurant big screen",
    "italian restaurant showing soccer"
  ],
  korean: [
    "korean restaurant sports tv",
    "korean bar soccer",
    "korean pub big screen",
    "korean restaurant showing soccer"
  ],
  izakaya: [
    "izakaya sports tv",
    "japanese izakaya soccer",
    "japanese bar big screen",
    "izakaya showing soccer"
  ],
  mexican: [
    "mexican restaurant sports tv",
    "taqueria bar soccer",
    "mexican restaurant big screen",
    "cantina showing soccer"
  ],
  indian: [
    "indian restaurant sports tv",
    "indian bar soccer",
    "indian restaurant big screen",
    "indian restaurant showing soccer"
  ],
  thai_viet: [
    "thai restaurant sports tv",
    "vietnamese restaurant sports tv",
    "thai restaurant big screen",
    "vietnamese restaurant showing soccer"
  ],
  cafe: [
    "cafe sports tv",
    "coffee shop soccer",
    "cafe big screen",
    "coffee shop showing soccer"
  ],
  western: [
    "american restaurant sports tv",
    "western restaurant sports bar",
    "grill bar big screen",
    "gastropub soccer"
  ],
  public_screen: [
    "world cup fan zone",
    "public viewing soccer big screen",
    "outdoor soccer screening",
    "world cup watch party plaza",
    "public big screen sports"
  ]
};

function normalizeCategory(category) {
  return Object.hasOwn(CATEGORY_QUERIES, category) ? category : "all";
}

const CATEGORY_LABELS = {
  all: "watch",
  sports_bar: "sports bar",
  restaurant: "restaurant",
  chinese: "Chinese",
  italian: "Italian",
  korean: "Korean",
  izakaya: "Japanese / izakaya",
  mexican: "Mexican",
  indian: "Indian",
  thai_viet: "Thai / Vietnamese",
  cafe: "cafe",
  western: "American / Western",
  public_screen: "public screen"
};

function sourceStatus() {
  return {
    googlePlaces: Boolean(GOOGLE_MAPS_API_KEY),
    yelp: Boolean(YELP_API_KEY),
    ticketmaster: Boolean(TICKETMASTER_API_KEY),
    eventbrite: EVENTBRITE_TOKEN
      ? EVENTBRITE_PUBLIC_SEARCH_ENABLED
        ? "enabled"
        : "auth_ok_public_search_unavailable"
      : false,
    x: Boolean(X_BEARER_TOKEN),
    reddit: Boolean(REDDIT_BEARER_TOKEN),
    facebook: "restricted_partner_api",
    xiaohongshu: "partner_or_creator_submission"
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(html);
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Find nearby bars, restaurants, and public screens to watch World Cup matches with other fans.">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #17211e; background: #f7f8fb; line-height: 1.55; }
    main { max-width: 1120px; margin: 0 auto; padding: 0 20px 72px; }
    h1 { margin: 0 0 14px; font-size: clamp(40px, 7vw, 76px); line-height: 0.98; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 28px; line-height: 1.1; }
    h3 { margin: 0 0 8px; font-size: 18px; }
    p, li { font-size: 16px; }
    a { color: #0b7f69; }
    nav { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid #dfe5e2; }
    nav .brand { font-weight: 800; color: #17211e; text-decoration: none; }
    nav .links { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
    nav .links a { color: #40504a; text-decoration: none; font-size: 14px; font-weight: 650; }
    section { padding: 44px 0; }
    .hero { min-height: 74vh; display: grid; grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr); gap: 30px; align-items: center; }
    .eyebrow { margin: 0 0 12px; color: #7b5b00; font-weight: 750; text-transform: uppercase; font-size: 13px; letter-spacing: 0.08em; }
    .lead { max-width: 680px; margin: 0; font-size: 20px; color: #35433f; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 8px; border: 1px solid #0b7f69; background: #0b7f69; color: #fff; text-decoration: none; font-weight: 750; }
    .button.secondary { background: #fff; color: #0b7f69; }
    .note { margin-top: 14px; color: #66736e; font-size: 14px; }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .card { background: #fff; border: 1px solid #d9e0da; border-radius: 8px; padding: 22px; box-shadow: 0 10px 28px rgba(24, 35, 31, 0.07); }
    .card h2, .card h3 { margin-top: 0; }
    .split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .demo-shell { min-width: 0; overflow: hidden; background: #fff; border: 1px solid #d9e0da; border-radius: 10px; padding: 12px; box-shadow: 0 18px 46px rgba(23, 33, 30, 0.12); }
    .demo-top { height: 38px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #e6ebe8; padding: 0 6px 10px; color: #66736e; font-size: 13px; }
    .dot { width: 10px; height: 10px; border-radius: 99px; background: #d24b45; box-shadow: 18px 0 #e6a500, 36px 0 #1b9b6c; }
    .demo-grid { min-width: 0; display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(226px, 0.88fr); gap: 10px; padding-top: 12px; }
    .map-pane { min-height: 440px; min-width: 0; position: relative; overflow: hidden; border: 1px solid #e2e7e4; border-radius: 8px; background: linear-gradient(90deg, #e7ece9 1px, transparent 1px), linear-gradient(#e7ece9 1px, transparent 1px), #f9faf8; background-size: 54px 54px; }
    .map-road { position: absolute; height: 12px; background: #d2d9d5; border-radius: 99px; transform: rotate(-18deg); }
    .road-a { width: 82%; left: -8%; top: 38%; }
    .road-b { width: 72%; right: -12%; top: 62%; transform: rotate(22deg); }
    .road-c { width: 56%; left: 22%; top: 18%; transform: rotate(8deg); }
    .pin { position: absolute; width: 130px; min-height: 64px; border: 1px solid #d9e0da; border-radius: 8px; background: #fff; padding: 10px; box-shadow: 0 8px 22px rgba(23, 33, 30, 0.13); animation: pulse 7s infinite; }
    .pin strong { display: block; font-size: 13px; }
    .pin span { display: block; color: #66736e; font-size: 12px; }
    .pin.one { left: 8%; top: 20%; }
    .pin.two { right: 8%; top: 32%; animation-delay: 1.3s; }
    .pin.three { left: 31%; bottom: 14%; animation-delay: 2.6s; }
    .search-card { position: absolute; left: 18px; top: 18px; right: 18px; border: 1px solid #d9e0da; border-radius: 8px; background: #fff; padding: 12px 14px; box-shadow: 0 8px 20px rgba(23, 33, 30, 0.1); }
    .search-card b { display: block; }
    .search-card span { color: #66736e; font-size: 13px; }
    .panel { min-width: 0; border: 1px solid #d9e0da; border-radius: 8px; background: #fbfcfb; overflow: hidden; }
    .panel-head { padding: 12px; color: #fff; background: #121820; border-bottom: 4px solid #0b7f69; }
    .panel-head small { color: #c8d0cc; }
    .panel-body { padding: 10px; display: grid; gap: 9px; }
    .control-row { display: flex; flex-wrap: wrap; gap: 7px; }
    .chip, .mini-button { border: 1px solid #d9e0da; background: #fff; border-radius: 999px; padding: 7px 9px; font-size: 12px; font-weight: 700; color: #40504a; }
    .mini-button { border-radius: 8px; color: #0b7f69; }
    .venue { min-width: 0; background: #fff; border: 1px solid #d9e0da; border-radius: 8px; padding: 10px; animation: slideVenue 7s infinite; }
    .venue:nth-child(3) { animation-delay: 1.4s; }
    .venue:nth-child(4) { animation-delay: 2.8s; }
    .venue-top { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
    .score { white-space: nowrap; background: #0b7f69; color: #fff; border-radius: 999px; padding: 4px 8px; font-size: 12px; font-weight: 800; }
    .venue p { margin: 4px 0 0; color: #66736e; font-size: 13px; }
    .bar { height: 8px; background: #e7ece9; border-radius: 99px; overflow: hidden; margin-top: 10px; }
    .bar span { display: block; height: 100%; width: 92%; background: #0b7f69; border-radius: inherit; }
    .steps { counter-reset: step; display: grid; gap: 12px; }
    .step { display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start; }
    .step:before { counter-increment: step; content: counter(step); width: 34px; height: 34px; display: grid; place-items: center; border-radius: 99px; background: #e8f3ef; color: #0b7f69; font-weight: 800; }
    .faq { display: grid; gap: 12px; }
    .faq details { background: #fff; border: 1px solid #d9e0da; border-radius: 8px; padding: 16px 18px; }
    .faq summary { cursor: pointer; font-weight: 750; }
    footer { padding-top: 28px; border-top: 1px solid #dfe5e2; color: #66736e; font-size: 14px; }
    .muted { color: #62706a; }
    code { background: #edf1ed; border-radius: 6px; padding: 2px 6px; }
    @keyframes pulse { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes slideVenue { 0%, 100% { transform: translateX(0); border-color: #d9e0da; } 45% { transform: translateX(-4px); border-color: #0b7f69; } }
    @media (max-width: 900px) { .hero, .demo-grid, .split { grid-template-columns: 1fr; } .map-pane { min-height: 360px; } nav .links { display: none; } }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

function privacyPolicyHtml() {
  return pageShell("WorldCupWatchPlace Privacy Policy", `
    <section class="card">
      <h1>WorldCupWatchPlace Privacy Policy</h1>
      <p class="muted">Last updated: June 24, 2026</p>
      <p>WorldCupWatchPlace helps fans find public places to watch World Cup matches. This policy explains what data the Chrome extension and backend use.</p>

      <h2>Information We Use</h2>
      <ul>
        <li><strong>Location:</strong> If you choose "Near me", the extension uses your approximate browser location to search nearby venues. You can also type any city or address manually.</li>
        <li><strong>Local preferences:</strong> Watch list, selected match, filters, and saved location preferences are stored in your browser storage.</li>
        <li><strong>Venue feedback:</strong> If you tap feedback such as "Right place", "Not showing", "Too crowded", or "Can reserve", the extension sends that venue-level signal to our backend.</li>
      </ul>

      <h2>How We Use Information</h2>
      <ul>
        <li>To recommend nearby venues and public viewing spots.</li>
        <li>To calculate driving distance and match times in the selected location's time zone.</li>
        <li>To improve venue confidence signals for other fans.</li>
      </ul>

      <h2>External Services</h2>
      <p>The backend may use Google Maps/Places/Distance Matrix, Ticketmaster Discovery API, and optional event or social data sources to find venues and public event listings. API keys are stored on the backend, not in the Chrome extension package.</p>

      <h2>What We Do Not Do</h2>
      <ul>
        <li>We do not sell personal data.</li>
        <li>We do not collect private messages or payment information.</li>
        <li>We do not use Reddit, X, or other social content for model training.</li>
        <li>We do not display your precise location to other users.</li>
      </ul>

      <h2>Contact</h2>
      <p>For privacy questions, contact the project owner at <a href="mailto:li3166944467@gmail.com">li3166944467@gmail.com</a>.</p>
    </section>
  `);
}

function homeHtml() {
  return pageShell("WorldCupWatchPlace", `
    <nav>
      <a class="brand" href="/">WorldCupWatchPlace</a>
      <div class="links">
        <a href="#demo">Demo</a>
        <a href="#why">What it solves</a>
        <a href="#how">How it works</a>
        <a href="#faq">FAQ</a>
        <a href="/privacy">Privacy</a>
      </div>
    </nav>

    <section class="hero">
      <div>
        <p class="eyebrow">Free Chrome extension</p>
        <h1>Find the right place to watch the World Cup.</h1>
        <p class="lead">Search near you or any city. Compare sports bars, restaurants, public screens, driving time, match-time fit, and whether you should call before going.</p>
        <div class="actions">
          <a class="button" href="https://chromewebstore.google.com/detail/worldcupwatchplace/lfldfjappaoefoekgbpggldhhhjlaabd">Add to Chrome free</a>
          <a class="button secondary" href="#demo">See it in action</a>
        </div>
        <p class="note">Independent fan tool. Not affiliated with FIFA or any official tournament organizer.</p>
      </div>

      <div class="demo-shell" id="demo" aria-label="WorldCupWatchPlace product demo">
        <div class="demo-top"><span class="dot"></span><span style="margin-left: 44px;">Google Maps + WorldCupWatchPlace side panel</span></div>
        <div class="demo-grid">
          <div class="map-pane">
            <div class="search-card">
              <b>Palo Alto, CA</b>
              <span>World Cup watch places nearby</span>
            </div>
            <div class="map-road road-a"></div>
            <div class="map-road road-b"></div>
            <div class="map-road road-c"></div>
            <div class="pin one"><strong>The Patio</strong><span>8 min drive</span></div>
            <div class="pin two"><strong>Sports Page</strong><span>16 min drive</span></div>
            <div class="pin three"><strong>Local Tap</strong><span>12 min drive</span></div>
          </div>
          <aside class="panel">
            <div class="panel-head">
              <strong>WorldCupWatchPlace</strong><br>
              <small>Brazil vs Scotland | Today 3:00 PM</small>
            </div>
            <div class="panel-body">
              <div class="control-row">
                <span class="chip">Near me</span>
                <span class="chip">Sports bar</span>
                <span class="chip">Nearest</span>
              </div>
              <div class="venue">
                <div class="venue-top"><strong>The Patio</strong><span class="score">98% fit</span></div>
                <p>Sports-friendly, groups, website/reserve available.</p>
                <div class="bar"><span></span></div>
              </div>
              <div class="venue">
                <div class="venue-top"><strong>Sports Page</strong><span class="score">96% fit</span></div>
                <p>Likely watch spot. Call to confirm this match.</p>
                <div class="bar"><span style="width: 86%;"></span></div>
              </div>
              <div class="venue">
                <div class="venue-top"><strong>Public Viewing</strong><span class="score">Event</span></div>
                <p>Confirmed event listings appear above likely spots.</p>
                <div class="bar"><span style="width: 76%; background:#b77900;"></span></div>
              </div>
              <div class="control-row">
                <span class="mini-button">Map</span>
                <span class="mini-button">Website/Reserve</span>
                <span class="mini-button">Call</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>

    <section id="why">
      <p class="eyebrow">What hurts?</p>
      <h2>Finding a watch place should not take twenty group chats.</h2>
      <div class="grid">
        <article class="card">
          <h3>You need somewhere close.</h3>
          <p>Sort by driving distance and time instead of guessing from search results.</p>
        </article>
        <article class="card">
          <h3>You need the match on.</h3>
          <p>The app separates confirmed event listings from likely sports-friendly venues.</p>
        </article>
        <article class="card">
          <h3>You need the right vibe.</h3>
          <p>Filter by sports bar, Chinese, Korean, izakaya, Italian, cafe, public screen, and more.</p>
        </article>
      </div>
    </section>

    <section id="how" class="split">
      <div class="card">
        <p class="eyebrow">How to use it</p>
        <div class="steps">
          <div class="step"><div><h3>Add it to Chrome</h3><p>Open the extension from the toolbar or side panel.</p></div></div>
          <div class="step"><div><h3>Pick a place</h3><p>Use Near me or type any city, neighborhood, or address.</p></div></div>
          <div class="step"><div><h3>Choose the match</h3><p>Match times update to the searched location's time zone.</p></div></div>
          <div class="step"><div><h3>Go smarter</h3><p>Open Maps, call, or go to Website/Reserve before leaving.</p></div></div>
        </div>
      </div>
      <div class="card">
        <p class="eyebrow">Data signals</p>
        <h2>Real venue data first. Social proof when available.</h2>
        <p>WorldCupWatchPlace uses venue, route, rating, opening, reservation, and event-listing signals. Fan mentions from sources such as Reddit or X can strengthen confidence only when they mention the venue and match-watching intent.</p>
      </div>
    </section>

    <section id="faq">
      <p class="eyebrow">Questions people ask</p>
      <div class="faq">
        <details open><summary>Is it free?</summary><p>Yes. The Chrome extension is free to install and use.</p></details>
        <details><summary>Does it guarantee a venue is showing the match?</summary><p>No. Confirmed event listings are labeled when available. Likely watch spots should be called before you go.</p></details>
        <details><summary>Does it sell my data?</summary><p>No. Location is used for venue search, and venue feedback is used to improve confidence signals. See the privacy policy for details.</p></details>
      </div>
    </section>

    <section class="card">
      <h2>Find a better watch spot.</h2>
      <p>Free for World Cup fans who want a place with screens, energy, and a plan.</p>
      <div class="actions">
        <a class="button" href="https://chromewebstore.google.com/detail/worldcupwatchplace/lfldfjappaoefoekgbpggldhhhjlaabd">Add to Chrome free</a>
        <a class="button secondary" href="https://github.com/LXTTT0323/worldcupwatchplace">Open source</a>
      </div>
    </section>

    <footer>
      <p>© 2026 WorldCupWatchPlace | <a href="/privacy">Privacy</a> | <a href="https://github.com/LXTTT0323/worldcupwatchplace">GitHub</a> | <a href="/api/health">API health</a></p>
      <p>Independent tool. Not affiliated with, endorsed by, or sponsored by FIFA, the FIFA World Cup, or any official tournament platform.</p>
    </footer>
  `);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function parseOffsetTime(date, time) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})\s+UTC([+-]\d{1,2})$/);
  if (!date || !match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const offset = Number(match[3]);
  const utcMs = Date.UTC(...date.split("-").map((part, index) => index === 1 ? Number(part) - 1 : Number(part)), hours - offset, minutes);
  return new Date(utcMs);
}

function formatKickoff(iso, timeZone) {
  if (!iso) return "Time TBD";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone
  }).format(date);
}

function localizeMatch(match, timeZone) {
  return {
    ...match,
    kickoff: formatKickoff(match.kickoffAt, timeZone),
    timeZone
  };
}

function matchId(match, index) {
  const slug = `${match.date}-${match.team1}-${match.team2}-${match.ground || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `wc26-${index + 1}-${slug}`;
}

async function fetchMatches() {
  const now = Date.now();
  if (memoryCache.matches && now - memoryCache.matchesFetchedAt < 15 * 60_000) {
    return memoryCache.matches;
  }

  const response = await fetch(WORLD_CUP_DATA_URL, {
    headers: { "user-agent": USER_AGENT }
  });
  if (!response.ok) throw new Error(`World Cup data failed: ${response.status}`);
  const data = await response.json();
  const matches = (data.matches || []).map((match, index) => {
    const kickoff = parseOffsetTime(match.date, match.time);
    const score = match.score && match.score.ft ? `${match.score.ft[0]}-${match.score.ft[1]}` : null;
    return {
      id: matchId(match, index),
      label: `${match.team1} vs ${match.team2}`,
      team1: match.team1,
      team2: match.team2,
      kickoffAt: kickoff ? kickoff.toISOString() : null,
      kickoff: formatKickoff(kickoff ? kickoff.toISOString() : null),
      stage: match.round || match.group || "World Cup",
      group: match.group || null,
      ground: match.ground || null,
      score,
      completed: Boolean(score),
      source: "openfootball/worldcup.json"
    };
  }).sort((a, b) => String(a.kickoffAt || "").localeCompare(String(b.kickoffAt || "")));

  memoryCache.matches = matches;
  memoryCache.matchesFetchedAt = now;
  return matches;
}

async function geocode(location) {
  const key = location.trim().toLowerCase();
  if (memoryCache.geocode.has(key)) return memoryCache.geocode.get(key);

  let result;
  if (GOOGLE_MAPS_API_KEY) {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", location);
    url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
    const response = await fetch(url);
    const data = await response.json();
    const first = data.results && data.results[0];
    if (!first) throw new Error(`Could not geocode location: ${location}`);
    result = {
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
      label: first.formatted_address,
      source: "google_geocoding"
    };
  } else {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", location);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    const data = await response.json();
    const first = data && data[0];
    if (!first) throw new Error(`Could not geocode location: ${location}`);
    result = {
      lat: Number(first.lat),
      lng: Number(first.lon),
      label: first.display_name,
      source: "nominatim"
    };
  }

  memoryCache.geocode.set(key, result);
  return result;
}

async function timeZoneFor(center, requestedTimeZone) {
  if (requestedTimeZone) return requestedTimeZone;

  const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  if (memoryCache.timeZones.has(cacheKey)) return memoryCache.timeZones.get(cacheKey);

  let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/timezone/json");
      url.searchParams.set("location", `${center.lat},${center.lng}`);
      url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
      url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === "OK" && data.timeZoneId) {
        timeZone = data.timeZoneId;
      }
    } catch {
      // Keep the runtime timezone fallback.
    }
  }

  memoryCache.timeZones.set(cacheKey, timeZone);
  return timeZone;
}

async function resolveCenter(url) {
  if (url.searchParams.has("lat") && url.searchParams.has("lng")) {
    return {
      lat: Number(url.searchParams.get("lat")),
      lng: Number(url.searchParams.get("lng")),
      label: url.searchParams.get("location") || "Nearby",
      source: "client_geolocation"
    };
  }

  const location = url.searchParams.get("location") || "San Francisco, CA";
  return geocode(location);
}

function distanceMiles(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function metersToMiles(meters) {
  return meters / 1609.344;
}

function formatDriveDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min drive`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min drive` : `${hours} hr drive`;
}

function directionsUrl(center, venue) {
  const destination = venue.lat && venue.lng
    ? `${venue.lat},${venue.lng}`
    : [venue.name, venue.address].filter(Boolean).join(" ");
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${center.lat},${center.lng}`);
  url.searchParams.set("destination", destination);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

async function enrichVenuesWithDrivingRoutes(center, venues) {
  const routeable = venues.filter((venue) => Number.isFinite(venue.lat) && Number.isFinite(venue.lng));
  if (!GOOGLE_MAPS_API_KEY || !routeable.length) {
    return venues.map((venue) => ({
      ...venue,
      mapsUrl: directionsUrl(center, venue)
    }));
  }

  const enriched = new Map();
  for (let index = 0; index < routeable.length; index += 25) {
    const batch = routeable.slice(index, index + 25);
    const destinations = batch.map((venue) => `${venue.lat},${venue.lng}`).join("|");
    const cacheKey = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}:${destinations}`;
    const cached = memoryCache.routes.get(cacheKey);
    let elements = cached && Date.now() - cached.fetchedAt < 5 * 60_000 ? cached.elements : null;

    if (!elements) {
      try {
        const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
        url.searchParams.set("origins", `${center.lat},${center.lng}`);
        url.searchParams.set("destinations", destinations);
        url.searchParams.set("mode", "driving");
        url.searchParams.set("departure_time", "now");
        url.searchParams.set("units", "imperial");
        url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
        const response = await fetch(url);
        const data = await response.json();
        elements = data.status === "OK" && data.rows && data.rows[0] ? data.rows[0].elements || [] : [];
        memoryCache.routes.set(cacheKey, { fetchedAt: Date.now(), elements });
      } catch {
        elements = [];
      }
    }

    batch.forEach((venue, batchIndex) => {
      const element = elements[batchIndex];
      if (element && element.status === "OK" && element.distance && element.duration) {
        const duration = element.duration_in_traffic || element.duration;
        enriched.set(venue.providerId, {
          driveDistanceMeters: element.distance.value,
          driveDistanceText: element.distance.text,
          driveDurationSeconds: duration.value,
          driveDurationText: formatDriveDuration(duration.value),
          routeSource: element.duration_in_traffic ? "google_distance_matrix_traffic" : "google_distance_matrix"
        });
      }
    });
  }

  return venues.map((venue) => ({
    ...venue,
    ...(enriched.get(venue.providerId) || {}),
    mapsUrl: directionsUrl(center, venue)
  }));
}

function makeMapsUrl(name, address) {
  const query = encodeURIComponent([name, address].filter(Boolean).join(" "));
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

async function fetchGoogleVenues(center, radiusMeters, category) {
  const queries = CATEGORY_QUERIES[normalizeCategory(category)];
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.types",
    "places.primaryType",
    "places.rating",
    "places.userRatingCount",
    "places.nationalPhoneNumber",
    "places.googleMapsUri",
    "places.websiteUri",
    "places.currentOpeningHours",
    "places.regularOpeningHours",
    "places.businessStatus",
    "places.reservable",
    "places.goodForWatchingSports",
    "places.goodForGroups",
    "places.servesBeer",
    "places.servesCocktails",
    "places.servesDinner",
    "places.priceLevel",
    "places.priceRange"
  ].join(",");
  const collected = new Map();

  for (const textQuery of queries) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": GOOGLE_MAPS_API_KEY,
        "x-goog-fieldmask": fieldMask
      },
      body: JSON.stringify({
        textQuery,
        locationBias: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: radiusMeters
          }
        },
        maxResultCount: 12
      })
    });
    if (!response.ok) throw new Error(`Google Places failed: ${response.status}`);
    const data = await response.json();
    for (const place of data.places || []) {
      collected.set(place.id, place);
    }
  }

  return Array.from(collected.values()).map((place) => ({
    source: "google_places",
    providerId: place.id,
    name: place.displayName && place.displayName.text || "Unnamed place",
    address: place.formattedAddress || "",
    lat: place.location && place.location.latitude,
    lng: place.location && place.location.longitude,
    type: place.primaryType || (place.types || [])[0] || "venue",
    phone: place.nationalPhoneNumber || "",
    website: place.websiteUri || "",
    mapsUrl: place.googleMapsUri || makeMapsUrl(place.displayName && place.displayName.text, place.formattedAddress),
    rating: place.rating || null,
    userRatingCount: place.userRatingCount || 0,
    openNow: place.currentOpeningHours ? place.currentOpeningHours.openNow : null,
    openingHours: place.currentOpeningHours && Array.isArray(place.currentOpeningHours.weekdayDescriptions)
      ? place.currentOpeningHours.weekdayDescriptions.join("; ")
      : "",
    regularOpeningHours: place.regularOpeningHours || null,
    reservable: typeof place.reservable === "boolean" ? place.reservable : null,
    goodForWatchingSports: typeof place.goodForWatchingSports === "boolean" ? place.goodForWatchingSports : null,
    goodForGroups: typeof place.goodForGroups === "boolean" ? place.goodForGroups : null,
    servesBeer: typeof place.servesBeer === "boolean" ? place.servesBeer : null,
    servesCocktails: typeof place.servesCocktails === "boolean" ? place.servesCocktails : null,
    servesDinner: typeof place.servesDinner === "boolean" ? place.servesDinner : null,
    priceLevel: place.priceLevel || "",
    priceRange: place.priceRange || null,
    rawTypes: place.types || []
  }));
}

async function fetchYelpBusinesses(center, radiusMeters, sortMode, category) {
  if (!YELP_API_KEY) return [];

  const url = new URL("https://api.yelp.com/v3/businesses/search");
  url.searchParams.set("latitude", String(center.lat));
  url.searchParams.set("longitude", String(center.lng));
  url.searchParams.set("term", CATEGORY_QUERIES[normalizeCategory(category)][0]);
  url.searchParams.set("radius", String(Math.min(40000, radiusMeters)));
  url.searchParams.set("limit", "20");
  url.searchParams.set("sort_by", sortMode === "distance" ? "distance" : "best_match");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${YELP_API_KEY}`,
      "user-agent": USER_AGENT
    }
  });
  if (!response.ok) throw new Error(`Yelp failed: ${response.status}`);
  const data = await response.json();
  return data.businesses || [];
}

function yelpVenueFromBusiness(business) {
  const lat = business.coordinates && business.coordinates.latitude;
  const lng = business.coordinates && business.coordinates.longitude;
  return {
    source: "yelp_fusion",
    providerId: `yelp-${business.id}`,
    name: business.name,
    address: business.location && Array.isArray(business.location.display_address)
      ? business.location.display_address.join(", ")
      : "",
    lat,
    lng,
    type: business.categories && business.categories[0] ? business.categories[0].title || business.categories[0].alias : "venue",
    phone: business.display_phone || business.phone || "",
    website: business.url || "",
    mapsUrl: makeMapsUrl(business.name, business.location && Array.isArray(business.location.display_address)
      ? business.location.display_address.join(", ")
      : ""),
    rating: business.rating || null,
    userRatingCount: business.review_count || 0,
    openNow: null,
    openingHours: "",
    priceText: business.price || "",
    rawTypes: (business.categories || []).flatMap((category) => [category.alias, category.title]).filter(Boolean)
  };
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeVenues(venues) {
  const seen = new Map();
  for (const venue of venues) {
    if (!venue || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lng) || !venue.name) continue;
    const key = `${normalizeSearchText(venue.name)}:${venue.lat.toFixed(3)},${venue.lng.toFixed(3)}`;
    const current = seen.get(key);
    if (!current || current.source !== "google_places") {
      seen.set(key, venue);
    }
  }
  return Array.from(seen.values());
}

function searchCityLabel(center) {
  return String(center.label || "nearby")
    .replace(/,\s*USA$/i, "")
    .split(",")
    .slice(0, 2)
    .join(",")
    .trim();
}

function matchSearchQueries(match, center) {
  const city = searchCityLabel(center);
  const teams = [match.team1, match.team2].filter(Boolean).join(" ");
  return [
    `"World Cup" "watch party" "${city}"`,
    `"FIFA" "watch party" "${city}"`,
    `"${match.team1}" "${match.team2}" "${city}"`,
    `"soccer" "viewing" "${city}"`
  ].filter((query, index, rows) => query && rows.indexOf(query) === index && (!teams || query.includes("World Cup") || query.includes(match.team1)));
}

function isMatchViewingSignalText(text, match) {
  const value = normalizeSearchText(text);
  const watchIntent = /\b(watch|watching|viewing|screening|showing|shows|show|broadcast|party|fan zone|big screen|reserve|reservation|table)\b/.test(value);
  const tournamentIntent = /\b(world cup|fifa|soccer|football|match|game)\b/.test(value);
  const teamIntent = [match.team1, match.team2]
    .filter(Boolean)
    .some((team) => value.includes(normalizeSearchText(team)));
  return watchIntent && (tournamentIntent || teamIntent);
}

function makeEventVenue({ source, id, title, url, venueName, address, lat, lng, startsAt, rawTypes = [] }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    source,
    providerId: `${source}-${id}`,
    name: venueName || title,
    address: [venueName && venueName !== title ? venueName : "", address].filter(Boolean).join(" - "),
    lat,
    lng,
    type: source === "ticketmaster" || source === "eventbrite" ? "watch party event" : "event venue",
    phone: "",
    website: url || "",
    mapsUrl: makeMapsUrl(venueName || title, address),
    rating: null,
    userRatingCount: 0,
    openNow: null,
    openingHours: startsAt ? `Event starts ${startsAt}` : "",
    rawTypes: ["watch party", "world cup", source, ...rawTypes],
    eventSignal: {
      source,
      title,
      url,
      startsAt
    }
  };
}

async function fetchTicketmasterEvents(center, radiusMeters, match) {
  if (!TICKETMASTER_API_KEY) return [];
  const cacheKey = `ticketmaster:${center.lat.toFixed(2)},${center.lng.toFixed(2)}:${match.id}`;
  const cached = memoryCache.externalSignals.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached.rows;

  const rows = [];
  for (const keyword of matchSearchQueries(match, center).slice(0, 2)) {
    try {
      const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
      url.searchParams.set("apikey", TICKETMASTER_API_KEY);
      url.searchParams.set("keyword", keyword.replaceAll('"', ""));
      url.searchParams.set("latlong", `${center.lat},${center.lng}`);
      url.searchParams.set("radius", String(Math.max(5, Math.round(radiusMeters / 1609.344))));
      url.searchParams.set("unit", "miles");
      url.searchParams.set("size", "20");
      url.searchParams.set("sort", "distance,asc");
      const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
      if (!response.ok) continue;
      const data = await response.json();
      for (const event of data._embedded && data._embedded.events || []) {
        const venue = event._embedded && event._embedded.venues && event._embedded.venues[0];
        const eventVenue = makeEventVenue({
          source: "ticketmaster",
          id: event.id,
          title: event.name,
          url: event.url,
          venueName: venue && venue.name,
          address: venue && venue.address && venue.address.line1 || venue && venue.city && venue.city.name || "",
          lat: Number(venue && venue.location && venue.location.latitude),
          lng: Number(venue && venue.location && venue.location.longitude),
          startsAt: event.dates && event.dates.start && (event.dates.start.dateTime || event.dates.start.localDate)
        });
        if (eventVenue) rows.push(eventVenue);
      }
    } catch {
      // Keep recommendations fast if this optional source fails.
    }
  }

  memoryCache.externalSignals.set(cacheKey, { fetchedAt: Date.now(), rows: dedupeVenues(rows) });
  return memoryCache.externalSignals.get(cacheKey).rows;
}

async function fetchEventbriteEvents(center, radiusMeters, match) {
  if (!EVENTBRITE_TOKEN || !EVENTBRITE_PUBLIC_SEARCH_ENABLED) return [];
  const cacheKey = `eventbrite:${center.lat.toFixed(2)},${center.lng.toFixed(2)}:${match.id}`;
  const cached = memoryCache.externalSignals.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached.rows;

  const rows = [];
  for (const keyword of matchSearchQueries(match, center).slice(0, 2)) {
    try {
      const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
      url.searchParams.set("q", keyword.replaceAll('"', ""));
      url.searchParams.set("location.latitude", String(center.lat));
      url.searchParams.set("location.longitude", String(center.lng));
      url.searchParams.set("location.within", `${Math.max(5, Math.round(radiusMeters / 1609.344))}mi`);
      url.searchParams.set("expand", "venue");
      url.searchParams.set("sort_by", "date");
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${EVENTBRITE_TOKEN}`,
          "user-agent": USER_AGENT
        }
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const event of data.events || []) {
        const venue = event.venue || {};
        const eventVenue = makeEventVenue({
          source: "eventbrite",
          id: event.id,
          title: event.name && event.name.text || "World Cup watch event",
          url: event.url,
          venueName: venue.name,
          address: venue.address && (venue.address.localized_address_display || venue.address.address_1) || "",
          lat: Number(venue.latitude),
          lng: Number(venue.longitude),
          startsAt: event.start && event.start.local
        });
        if (eventVenue) rows.push(eventVenue);
      }
    } catch {
      // Keep recommendations fast if this optional source fails.
    }
  }

  memoryCache.externalSignals.set(cacheKey, { fetchedAt: Date.now(), rows: dedupeVenues(rows) });
  return memoryCache.externalSignals.get(cacheKey).rows;
}

async function fetchXSignals(center, match) {
  if (!X_BEARER_TOKEN) return [];
  const cacheKey = `x:${center.lat.toFixed(2)},${center.lng.toFixed(2)}:${match.id}`;
  const cached = memoryCache.externalSignals.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached.rows;

  const rows = [];
  for (const query of matchSearchQueries(match, center).slice(0, 2)) {
    try {
      const url = new URL("https://api.x.com/2/tweets/search/recent");
      url.searchParams.set("query", `${query} -is:retweet lang:en`);
      url.searchParams.set("max_results", "20");
      url.searchParams.set("tweet.fields", "created_at,public_metrics");
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${X_BEARER_TOKEN}`,
          "user-agent": USER_AGENT
        }
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const tweet of data.data || []) {
        if (!isMatchViewingSignalText(tweet.text, match)) continue;
        rows.push({
          source: "x",
          venueName: "",
          text: tweet.text,
          summary: "Recent X posts mention this as a World Cup viewing signal.",
          mentionCount: 1,
          score: 9,
          matchLevel: true,
          url: `https://x.com/i/web/status/${tweet.id}`,
          createdAt: tweet.created_at
        });
      }
    } catch {
      // Optional source.
    }
  }

  memoryCache.externalSignals.set(cacheKey, { fetchedAt: Date.now(), rows });
  return rows;
}

async function fetchRedditSignals(center, match) {
  if (!REDDIT_BEARER_TOKEN) return [];
  const cacheKey = `reddit:${center.lat.toFixed(2)},${center.lng.toFixed(2)}:${match.id}`;
  const cached = memoryCache.externalSignals.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached.rows;

  const rows = [];
  for (const query of matchSearchQueries(match, center).slice(0, 2)) {
    try {
      const url = new URL("https://oauth.reddit.com/search");
      url.searchParams.set("q", query.replaceAll('"', ""));
      url.searchParams.set("sort", "new");
      url.searchParams.set("limit", "20");
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${REDDIT_BEARER_TOKEN}`,
          "user-agent": USER_AGENT
        }
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const child of data.data && data.data.children || []) {
        const post = child.data || {};
        const text = [post.title, post.selftext].filter(Boolean).join(" ");
        if (!isMatchViewingSignalText(text, match)) continue;
        rows.push({
          source: "reddit",
          venueName: "",
          text,
          summary: "Recent Reddit posts mention this as a World Cup viewing signal.",
          mentionCount: 1,
          score: 10,
          matchLevel: true,
          url: post.permalink ? `https://www.reddit.com${post.permalink}` : "",
          createdAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : ""
        });
      }
    } catch {
      // Optional source.
    }
  }

  memoryCache.externalSignals.set(cacheKey, { fetchedAt: Date.now(), rows });
  return rows;
}

async function fetchOverpassVenues(center, radiusMeters) {
  const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)},${radiusMeters}`;
  const cached = memoryCache.venues.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached.venues;

  const query = `
    [out:json][timeout:20];
    (
      node["amenity"~"bar|pub|restaurant|cafe"](around:${radiusMeters},${center.lat},${center.lng});
      way["amenity"~"bar|pub|restaurant|cafe"](around:${radiusMeters},${center.lat},${center.lng});
      relation["amenity"~"bar|pub|restaurant|cafe"](around:${radiusMeters},${center.lat},${center.lng});
    );
    out center tags 80;
  `;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      "user-agent": USER_AGENT
    },
    body: new URLSearchParams({ data: query })
  });
  if (!response.ok) throw new Error(`Overpass failed: ${response.status}`);
  const data = await response.json();
  const venues = (data.elements || [])
    .filter((item) => item.tags && item.tags.name)
    .map((item) => {
      const tags = item.tags || {};
      const lat = item.lat || item.center && item.center.lat;
      const lng = item.lon || item.center && item.center.lon;
      return {
        source: "openstreetmap_overpass",
        providerId: `osm-${item.type}-${item.id}`,
        name: tags.name,
        address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean).join(" "),
        lat,
        lng,
        type: tags.amenity || "venue",
        phone: tags.phone || tags["contact:phone"] || "",
        website: tags.website || tags["contact:website"] || "",
        mapsUrl: makeMapsUrl(tags.name, [tags["addr:street"], tags["addr:city"]].filter(Boolean).join(" ")),
        rating: null,
        userRatingCount: 0,
        openNow: null,
        openingHours: tags.opening_hours || "",
        rawTypes: [tags.amenity, tags.sport, tags.cuisine].filter(Boolean)
      };
    })
    .filter((venue) => Number.isFinite(venue.lat) && Number.isFinite(venue.lng));

  memoryCache.venues.set(cacheKey, { fetchedAt: Date.now(), venues });
  return venues;
}

async function readSignals() {
  try {
    const raw = await fs.readFile(SIGNALS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function appendJsonArray(filePath, item, limit = 5000) {
  const rows = await readJsonArray(filePath);
  rows.push(item);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(rows.slice(-limit), null, 2));
}

async function writeSignal(signal) {
  await appendJsonArray(SIGNALS_PATH, signal);
}

function venueSignalSummary(signals, venueId, matchId) {
  const active = signals.filter((signal) => signal.venueId === venueId && signal.matchId === matchId);
  const confirmed = active.filter((signal) => signal.feedbackType === "confirmed").length;
  const negative = active.filter((signal) => signal.feedbackType === "not_showing").length;
  const reservable = active.filter((signal) => signal.feedbackType === "reservable").length;
  const packed = active.filter((signal) => signal.feedbackType === "packed").length;
  return { confirmed, negative, reservable, packed, total: active.length };
}

function socialSignalSummary(socialSignals, venue, center, match) {
  const venueName = String(venue.name || "").toLowerCase();
  const matched = socialSignals.filter((signal) => {
    const signalName = String(signal.venueName || "").toLowerCase();
    const signalText = String(signal.text || signal.summary || "").toLowerCase();
    const explicitVenueMatch = signalName && (venueName.includes(signalName) || signalName.includes(venueName));
    const textVenueMatch = venueName.length > 4 && signalText.includes(venueName);
    if (signal.source === "x" || signal.source === "reddit") {
      return textVenueMatch && isMatchViewingSignalText(signalText, match);
    }
    return explicitVenueMatch || textVenueMatch && Boolean(signal.matchLevel);
  });

  if (!matched.length) {
    return {
      score: 0,
      mentionCount: 0,
      sources: [],
      matchLevel: false,
      summary: "No social signal cached yet",
      label: "Social: new"
    };
  }

  const sourceSet = new Set();
  let score = 0;
  let mentionCount = 0;
  let matchLevel = false;
  const summaries = [];
  for (const signal of matched) {
    score += Number(signal.score || 0);
    mentionCount += Number(signal.mentionCount || 0);
    matchLevel = matchLevel || Boolean(signal.matchLevel) || signal.source === "x" || signal.source === "reddit";
    summaries.push(signal.summary);
    for (const source of signal.sources || []) sourceSet.add(source);
    if (signal.source) sourceSet.add(signal.source);
  }

  return {
    score: Math.min(25, score),
    mentionCount,
    sources: Array.from(sourceSet),
    matchLevel,
    summary: summaries.find(Boolean) || "Cached fan discussion signal",
    label: mentionCount ? `Social: ${mentionCount}` : "Social: yes"
  };
}

function categoryFitScore(venue, category) {
  const text = [venue.type, ...(venue.rawTypes || []), venue.name, venue.address].join(" ").toLowerCase();
  const normalizedCategory = normalizeCategory(category);
  if (normalizedCategory === "public_screen") {
    const publicSignal = /public|outdoor|screening|big screen|fan zone|plaza|park|stadium|square|lawn|pier|waterfront|festival|amphitheater/.test(text);
    const watchPartySignal = /watch party|viewing|soccer|football|sports/.test(text);
    const foodVenueSignal = /bar|pub|restaurant|grill|kitchen|cafe|bistro|diner|cantina|brewery|gastropub/.test(text);
    if (publicSignal && !foodVenueSignal) return 20;
    if (publicSignal) return 12;
    if (watchPartySignal && !foodVenueSignal) return 8;
    return 0;
  }
  const patterns = {
    sports_bar: /sport|soccer|football|pub|bar/,
    restaurant: /restaurant|grill|kitchen|diner|cafe|bistro/,
    chinese: /chinese|china|szechuan|sichuan|canton|dim sum|dumpling|noodle/,
    italian: /italian|pizza|pasta|trattoria|osteria|ristorante/,
    korean: /korean|korea|bbq|soju|kimchi/,
    izakaya: /izakaya|japanese|sake|yakitori|ramen|sushi/,
    mexican: /mexican|taqueria|taco|burrito|cantina|mezcal|tequila/,
    indian: /indian|tandoor|curry|masala|biryani|dosa/,
    thai_viet: /thai|vietnamese|pho|banh mi|viet|pad thai/,
    cafe: /cafe|coffee|espresso|bakery|tea|brunch/,
    western: /american|grill|burger|steak|gastropub|western/,
    public_screen: /public|outdoor|screen|watch party|fan zone|plaza|park|stadium/
  };
  const pattern = patterns[normalizedCategory];
  return pattern && pattern.test(text) ? 12 : 0;
}

function scoreVenue(venue, center, signalsSummary, socialSummary, category) {
  const miles = venue.driveDistanceMeters
    ? metersToMiles(venue.driveDistanceMeters)
    : distanceMiles(center, { lat: venue.lat, lng: venue.lng });
  const typeText = [venue.type, ...(venue.rawTypes || []), venue.name].join(" ").toLowerCase();
  const normalizedCategory = normalizeCategory(category);
  let score = 35;

  if (normalizedCategory === "public_screen") {
    if (/public|outdoor|screening|big screen|fan zone|plaza|park|stadium|square|lawn/.test(typeText)) score += 18;
    if (/bar|pub|restaurant|grill|kitchen|cafe|bistro|diner|cantina|gastropub/.test(typeText)) score -= 8;
  } else {
    if (/sport|pub|bar/.test(typeText)) score += 18;
    if (/soccer|football|stadium|tap|pub|sports/.test(typeText)) score += 10;
  }
  if (venue.rating) score += Math.min(10, Math.max(0, (venue.rating - 3.5) * 7));
  if (venue.userRatingCount > 100) score += 6;
  if (venue.openNow === true) score += 8;
  if (venue.reservable === true || signalsSummary.reservable) score += 8;
  if (venue.goodForWatchingSports === true) score += 14;
  if (venue.goodForGroups === true) score += 5;
  if (venue.phone) score += 4;
  if (venue.website) score += 3;
  if (venue.eventSignal) score += 28;
  score += categoryFitScore(venue, category);
  score += Math.max(0, 12 - miles * 2);
  score -= Math.max(0, miles - 8) * 3;
  score += signalsSummary.confirmed * 22;
  score += socialSummary.score;
  score -= signalsSummary.negative * 30;
  score -= signalsSummary.packed * 5;

  return Math.max(1, Math.min(99, Math.round(score)));
}

function priceLabel(venue) {
  if (venue.priceText) return venue.priceText;
  if (venue.priceRange && venue.priceRange.startPrice && venue.priceRange.endPrice) {
    return `${venue.priceRange.startPrice.currencyCode || ""} ${venue.priceRange.startPrice.units || ""}-${venue.priceRange.endPrice.units || ""}`.trim();
  }
  if (venue.priceLevel) return String(venue.priceLevel).replace("PRICE_LEVEL_", "").replaceAll("_", " ").toLowerCase();
  if (venue.rating) return `${venue.rating.toFixed(1)} stars`;
  return "Real venue";
}

function normalizeVenue(venue, center, match, signalsSummary, socialSummary, category) {
  const confidence = scoreVenue(venue, center, signalsSummary, socialSummary, category);
  const aerialMiles = distanceMiles(center, { lat: venue.lat, lng: venue.lng });
  const driveMiles = venue.driveDistanceMeters ? metersToMiles(venue.driveDistanceMeters) : null;
  const displayMiles = driveMiles || aerialMiles;
  const categoryFit = categoryFitScore(venue, category);
  const hasEventListing = Boolean(venue.eventSignal);
  const isConfirmed = hasEventListing || signalsSummary.confirmed > 0 && signalsSummary.confirmed >= signalsSummary.negative;
  const status = isConfirmed ? "confirmed" : confidence >= 68 ? "likely" : "needs_check";
  const badges = [];
  const typeText = [venue.type, ...(venue.rawTypes || []), venue.name].join(" ").toLowerCase();

  if (signalsSummary.confirmed > 0) badges.push("User confirmed");
  if (hasEventListing) badges.push("Event listing");
  if (venue.goodForWatchingSports === true || /sport|soccer|football/.test(typeText)) badges.push("Sports-friendly");
  if (venue.goodForGroups === true) badges.push("Good for groups");
  if (venue.reservable === true || signalsSummary.reservable) badges.push("Reservable");
  if (/bar|pub/.test(typeText)) badges.push("Bar/pub");
  if (venue.servesBeer === true || venue.servesCocktails === true) badges.push("Drinks");
  if (venue.servesDinner === true) badges.push("Food");
  if (categoryFit > 0 && normalizeCategory(category) !== "all") badges.push("Type match");
  if (socialSummary.matchLevel) badges.push("Fan match signal");
  else if (socialSummary.score > 0) badges.push("Fan buzz");
  if (venue.openNow === true) badges.push("Open now");
  if (venue.phone) badges.push("Callable");
  if (signalsSummary.packed) badges.push("May be packed");
  if (!badges.length) badges.push("Needs check");

  const categoryLabel = CATEGORY_LABELS[normalizeCategory(category)] || "watch";
  const confirmationLabel = hasEventListing
    ? "Event listing"
    : signalsSummary.confirmed > 0
      ? "User confirmed"
      : socialSummary.matchLevel
        ? "Fan posts"
        : normalizeCategory(category) === "all"
          ? "Call to confirm"
          : `Likely ${categoryLabel} spot`;
  const evidenceRank = hasEventListing || signalsSummary.confirmed > 0
    ? 3
    : socialSummary.matchLevel
      ? 2
      : 0;
  const reason = hasEventListing
    ? `${venue.eventSignal.source} listing found: ${venue.eventSignal.title}. Check details and reserve if needed for ${match.label}.`
    : isConfirmed
    ? `A user signal says this venue is showing ${match.label}. Reconfirm seating before you go.`
    : socialSummary.matchLevel
      ? `${socialSummary.summary} Reconfirm details before you go for ${match.label}.`
    : status === "likely"
      ? `Strong nearby fit for watching sports, but no match-level confirmation yet for ${match.label}.`
      : `Real venue candidate, but call or check the website before you go for ${match.label}.`;

  const normalizedCategory = normalizeCategory(category);
  const reservationStatus = normalizedCategory === "public_screen"
    ? categoryFit >= 20
      ? "Public screen - no food assumed"
      : /bar|pub|restaurant|grill|kitchen|cafe|bistro|diner|cantina|gastropub/.test(typeText)
        ? "Watch-party venue - check food/access"
        : categoryFit >= 12
          ? "Public screen candidate"
          : venue.website
            ? "Check public access"
            : "Call to verify"
    : venue.reservable === true || signalsSummary.reservable
    ? "Reservable"
    : venue.website
      ? "Reservation unknown"
      : "Call to ask";

  return {
    id: venue.providerId,
    providerId: venue.providerId,
    source: venue.source,
    category,
    categoryFit,
    name: venue.name,
    type: venue.type.replaceAll("_", " "),
    distance: venue.driveDistanceText || `${aerialMiles.toFixed(1)} mi straight-line`,
    distanceMiles: Number(displayMiles.toFixed(3)),
    straightLineDistanceMiles: Number(aerialMiles.toFixed(3)),
    driveDistanceMiles: driveMiles ? Number(driveMiles.toFixed(3)) : null,
    sortDistanceMeters: venue.driveDistanceMeters || Math.round(aerialMiles * 1609.344),
    eta: venue.driveDurationText || "Drive time unavailable",
    travelMode: venue.driveDistanceMeters ? "driving" : "straight_line_fallback",
    routeSource: venue.routeSource || "distance_fallback",
    area: venue.address || "Nearby",
    price: priceLabel(venue),
    status,
    confidence,
    badges: badges.slice(0, 5),
    open: venue.openNow === true ? "Open now" : venue.openingHours ? "Hours listed - check match time" : "Hours need check",
    reason,
    rating: venue.rating,
    userRatingCount: venue.userRatingCount,
    socialFit: socialSummary.score,
    socialMentions: socialSummary.mentionCount,
    socialSources: socialSummary.sources,
    socialSummary: socialSummary.summary,
    socialLabel: socialSummary.label,
    confirmationLabel,
    evidenceRank,
    matchEvidenceUrl: hasEventListing ? venue.eventSignal.url || "" : "",
    eventSignal: venue.eventSignal || null,
    reservationStatus,
    reservable: venue.reservable === true || Boolean(signalsSummary.reservable),
    goodForGroups: venue.goodForGroups,
    goodForWatchingSports: venue.goodForWatchingSports,
    phone: venue.phone || "",
    website: venue.website || "",
    mapsUrl: venue.mapsUrl,
    lat: venue.lat,
    lng: venue.lng,
    signals: signalsSummary
  };
}

function categoryFilteredVenues(venues, category) {
  const normalized = normalizeCategory(category);
  if (normalized === "all") return venues;
  if (normalized === "public_screen") {
    const publicSpaceMatches = venues.filter((venue) => venue.categoryFit >= 20);
    if (publicSpaceMatches.length >= 3) return publicSpaceMatches;

    const publicWatchMatches = venues.filter((venue) => venue.categoryFit >= 12);
    return publicWatchMatches.length >= 3 ? publicWatchMatches : venues;
  }

  const matched = venues.filter((venue) => venue.categoryFit > 0);
  return matched.length >= 5 ? matched : venues;
}

function nearbyDrivingFilteredVenues(venues, radiusMeters) {
  const driveLimitMeters = Math.max(8000, radiusMeters * 2.2);
  const nearby = venues.filter((venue) => venue.sortDistanceMeters <= driveLimitMeters);
  return nearby.length >= 5 ? nearby : venues;
}

async function recommendations(url) {
  const radiusMeters = Math.min(10000, Math.max(1000, Number(url.searchParams.get("radiusMeters") || 5000)));
  const sortMode = url.searchParams.get("sort") === "distance" ? "distance" : "recommended";
  const category = normalizeCategory(url.searchParams.get("category") || "all");
  const matchIdFromRequest = url.searchParams.get("matchId");
  const center = await resolveCenter(url);
  const timeZone = await timeZoneFor(center, url.searchParams.get("timeZone"));
  const matches = (await fetchMatches()).map((match) => localizeMatch(match, timeZone));
  const now = Date.now();
  const futureMatches = matches.filter((match) => match.kickoffAt && new Date(match.kickoffAt).getTime() > now - 2 * 60 * 60_000);
  const match = matches.find((item) => item.id === matchIdFromRequest) || futureMatches[0] || matches[0];

  const primaryVenues = GOOGLE_MAPS_API_KEY
    ? await fetchGoogleVenues(center, radiusMeters, category)
    : await fetchOverpassVenues(center, radiusMeters);
  const [
    yelpBusinesses,
    ticketmasterVenues,
    eventbriteVenues,
    xSignals,
    redditSignals
  ] = await Promise.all([
    fetchYelpBusinesses(center, radiusMeters, sortMode, category).catch(() => []),
    fetchTicketmasterEvents(center, radiusMeters, match).catch(() => []),
    fetchEventbriteEvents(center, radiusMeters, match).catch(() => []),
    fetchXSignals(center, match).catch(() => []),
    fetchRedditSignals(center, match).catch(() => [])
  ]);
  const rawVenues = dedupeVenues([
    ...primaryVenues,
    ...yelpBusinesses.map(yelpVenueFromBusiness),
    ...ticketmasterVenues,
    ...eventbriteVenues
  ]);
  const routedVenues = await enrichVenuesWithDrivingRoutes(center, rawVenues);

  const signals = await readSignals();
  const cachedSocialSignals = await readJsonArray(SOCIAL_SIGNALS_PATH);
  const socialSignals = [
    ...cachedSocialSignals,
    ...xSignals,
    ...redditSignals
  ];
  const normalizedVenues = routedVenues
    .map((venue) => normalizeVenue(
      venue,
      center,
      match,
      venueSignalSummary(signals, venue.providerId, match.id),
      socialSignalSummary(socialSignals, venue, center, match),
      category
    ));

  const venues = nearbyDrivingFilteredVenues(categoryFilteredVenues(normalizedVenues, category), radiusMeters)
    .sort((a, b) => sortMode === "distance"
      ? a.sortDistanceMeters - b.sortDistanceMeters
      : category === "public_screen"
        ? b.evidenceRank - a.evidenceRank
          || b.categoryFit - a.categoryFit
          || a.sortDistanceMeters - b.sortDistanceMeters
          || b.confidence - a.confidence
          || b.socialFit - a.socialFit
          || (b.userRatingCount || 0) - (a.userRatingCount || 0)
      : b.evidenceRank - a.evidenceRank
        || b.confidence - a.confidence
        || a.sortDistanceMeters - b.sortDistanceMeters
        || b.socialFit - a.socialFit
        || (b.userRatingCount || 0) - (a.userRatingCount || 0))
    .slice(0, 20);

  return {
    ok: true,
    dataMode: GOOGLE_MAPS_API_KEY ? "google_places" : "openstreetmap_fallback",
    location: { ...center, timeZone },
    match,
    matches: futureMatches.slice(0, 40),
    sort: sortMode,
    category,
    sourceStatus: sourceStatus(),
    sourceCounts: {
      primaryVenues: primaryVenues.length,
      yelpVenues: yelpBusinesses.length,
      ticketmasterEvents: ticketmasterVenues.length,
      eventbriteEvents: eventbriteVenues.length,
      xPosts: xSignals.length,
      redditPosts: redditSignals.length
    },
    venues,
    generatedAt: new Date().toISOString()
  };
}

async function route(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/" && req.method === "GET") {
      return sendHtml(res, 200, homeHtml());
    }

    if (url.pathname === "/privacy" && req.method === "GET") {
      return sendHtml(res, 200, privacyPolicyHtml());
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        dataMode: GOOGLE_MAPS_API_KEY ? "google_places" : "openstreetmap_fallback",
        port: PORT,
        sourceStatus: sourceStatus()
      });
    }

    if (url.pathname === "/api/matches" && req.method === "GET") {
      const center = await resolveCenter(url);
      const timeZone = await timeZoneFor(center, url.searchParams.get("timeZone"));
      const matches = (await fetchMatches()).map((match) => localizeMatch(match, timeZone));
      const now = Date.now();
      return sendJson(res, 200, {
        ok: true,
        source: WORLD_CUP_DATA_URL,
        location: { ...center, timeZone },
        matches: matches.filter((match) => match.kickoffAt && new Date(match.kickoffAt).getTime() > now - 2 * 60 * 60_000).slice(0, 40)
      });
    }

    if (url.pathname === "/api/recommendations" && req.method === "GET") {
      return sendJson(res, 200, await recommendations(url));
    }

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.venueId || !body.matchId || !body.feedbackType) {
        return sendJson(res, 400, { ok: false, error: "venueId, matchId and feedbackType are required" });
      }
      const signal = {
        venueId: String(body.venueId),
        matchId: String(body.matchId),
        feedbackType: String(body.feedbackType),
        source: "extension_user",
        createdAt: new Date().toISOString()
      };
      await writeSignal(signal);
      return sendJson(res, 200, { ok: true, signal });
    }

    if (url.pathname === "/api/plan-event" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.venueId || !body.matchId || !body.eventType) {
        return sendJson(res, 400, { ok: false, error: "venueId, matchId and eventType are required" });
      }
      const event = {
        venueId: String(body.venueId),
        venueName: body.venueName ? String(body.venueName) : "",
        matchId: String(body.matchId),
        eventType: String(body.eventType),
        source: "extension_user",
        createdAt: new Date().toISOString()
      };
      await appendJsonArray(PLAN_EVENTS_PATH, event);
      return sendJson(res, 200, { ok: true, event });
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message });
  }
}

http.createServer(route).listen(PORT, HOST, () => {
  console.log(`WorldCupWatchPlace backend running at http://${HOST}:${PORT}`);
  console.log(`Data mode: ${GOOGLE_MAPS_API_KEY ? "Google Places" : "OpenStreetMap fallback"}`);
});

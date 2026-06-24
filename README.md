# WorldCupWatchPlace Backend

Local API for the Chrome extension prototype.

## Start

```powershell
cd C:\Users\li316\Documents\Codex\2026-06-20\bar-googlemap\outputs\worldcupwatchplace-backend
$env:PORT="8788"
$env:GOOGLE_MAPS_API_KEY="your-key-optional"
$env:YELP_API_KEY="optional-yelp-fusion-key"
$env:TICKETMASTER_API_KEY="optional-ticketmaster-key"
$env:EVENTBRITE_TOKEN="optional-eventbrite-token"
$env:EVENTBRITE_PUBLIC_SEARCH_ENABLED="0"
$env:X_BEARER_TOKEN="optional-x-bearer-token"
$env:REDDIT_BEARER_TOKEN="optional-reddit-oauth-token"
node server.js
```

The backend uses Google Places when `GOOGLE_MAPS_API_KEY` is set. Without a key it uses Nominatim and Overpass as a real-data fallback, which is good enough for prototypes and small tests but not production scale.

Optional connectors are automatic:

- Ticketmaster adds watch-party or fan-zone event listings.
- Eventbrite tokens authenticate successfully for account-owned resources, but the public event search endpoint returns 404 for normal tokens. Keep `EVENTBRITE_PUBLIC_SEARCH_ENABLED=0` unless your account has explicit public-search access. Treat Eventbrite as an owned-event or manual-import source.
- X and Reddit add match-level fan signals only when a post contains the venue name plus World Cup/team/watch/showing/viewing intent.
- Yelp adds extra restaurant venue candidates and review/rating metadata.
- Facebook and Xiaohongshu are marked as partner/import sources rather than open live-search APIs.

## Endpoints

- `GET /api/health`
- `GET /api/matches`
- `GET /api/recommendations?location=San%20Francisco%2C%20CA&matchId=...`
- `POST /api/feedback`

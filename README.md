# MyTravel4Sure — Production Build

This build keeps the approved bright white/cyan/orange homepage direction and turns the earlier visual prototype into a functional enquiry-led holiday website.

## What is active

- Responsive cinematic homepage with the supplied MyTravel4Sure logo and supplied design assets.
- Holiday search with destination, region, travel-style and budget filters.
- India, International, Honeymoon, Experiences, Destinations, About and Contact pages.
- Dynamic package detail pages and clear `reference price` / `price on request` states.
- Enquiry capture before WhatsApp handoff.
- Newsletter capture.
- Admin dashboard for leads, lead status, subscribers, package price and publish status.
- Local persistent SQLite database using Node's built-in `node:sqlite` (no npm dependency).
- Vercel/Supabase serverless API adapter for persistent production deployment.
- Responsive layouts, focus-trapped enquiry modal, reduced-motion support, lazy-loaded listing imagery, 404 page, robots.txt, sitemap.xml and security headers.
- No fake online payment, live hotel inventory or flight availability is claimed.

## Run on Windows — no npm install required

Requires Node.js 22.5+ (Node 24 LTS is recommended).

```powershell
Set-Location "C:\path\to\MyTravel4Sure-PRODUCTION-FINAL"; node --no-warnings server.mjs
```

Open `http://127.0.0.1:4173`.

For local testing only, the admin page is `http://127.0.0.1:4173/admin.html` and the development fallback password is `ChangeMe123!`.

**Before public production use, do not use the development fallback password.** Set secure environment values:

```powershell
$env:NODE_ENV="production"; $env:MYTRAVEL_ADMIN_PASSWORD="YOUR-LONG-UNIQUE-PASSWORD"; $env:MYTRAVEL_SESSION_SECRET="A-LONG-RANDOM-SECRET-AT-LEAST-32-BYTES"; node --no-warnings server.mjs
```

## Vercel production persistence

Vercel's filesystem is not a persistent database. This project therefore includes a Supabase adapter for Vercel.

1. Create a Supabase project you control.
2. Run `supabase/schema.sql` once in its SQL editor.
3. Set these Vercel environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never expose it to browser code)
   - `MYTRAVEL_ADMIN_PASSWORD`
   - `MYTRAVEL_SESSION_SECRET`
   - `MYTRAVEL_WHATSAPP=919810958069`
4. Seed the package catalogue once from a trusted terminal:

```powershell
$env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node seed-supabase.mjs
```

5. Set `PUBLIC_SITE_URL` to the final HTTPS domain and run `node generate-sitemap.mjs` once so canonical crawl files use the real domain.
6. Deploy the folder to Vercel. `vercel.json` routes `/api/*` to the serverless adapter.

Without Supabase credentials on Vercel, package browsing still has a static read-only fallback, while lead/newsletter persistence and the admin dashboard intentionally report that production persistence is not configured.

## Important commercial-data note

Only the Kashmir `₹29,999` amount from the approved visual reference is retained and explicitly marked as a **reference price**. Other package templates use **Price on request** rather than invented live pricing. Confirm current supplier availability, final itinerary, cancellation terms and payable quote before accepting a booking.

## Audit

Run:

```powershell
node audit.mjs
```

The audit checks required production files, internal references, dead `#` links, package data integrity and image references.

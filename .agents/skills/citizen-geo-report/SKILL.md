# SKILL.md — Citizen Geo Report Platform

## 1. Project Purpose

This project is a mobile-first citizen reporting platform for the four southern border provinces of Thailand.

The platform allows citizens to:

- report local incidents or community problems
- attach photos or evidence
- capture the current GPS position
- manually place or drag a map marker
- switch between street, satellite, and hybrid map views
- submit reports for later verification and analysis

The system is designed to support a data lifecycle:

**Raw → Claim → Verified Fact → Derived → Hypothesis**

Do not collapse these stages into a single status. Preserve provenance and confidence throughout the system.

---

## 2. Primary Product Goals

Prioritize:

1. Mobile-first citizen reporting
2. Accurate and explainable location capture
3. Low infrastructure cost during Pilot
4. Safe handling of citizen location and evidence
5. GeoJSON-compatible data from day one
6. Architecture that can later support spatial analytics
7. Simple operations; avoid unnecessary Kubernetes or microservices during Pilot

The initial system is a Pilot. Optimize for learning and reliability, not theoretical scale.

---

## 3. Current Technology Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- React Hook Form
- Zod

### Map / GPS

- `react-map-gl`
- `maplibre-gl`
- Browser Geolocation API
- GeoJSON
- Satellite / hybrid raster or vector tile provider

### Database

- MongoDB Atlas
- MongoDB Native Driver preferred
- GeoJSON `Point`
- `2dsphere` indexes

### File Storage

Use object storage for images and attachments.

Preferred Pilot architecture:

- Cloudflare R2 or another S3-compatible object store

Do **not** store uploaded image binary data directly inside MongoDB.

### Hosting

Pilot:

- Vercel for Next.js
- MongoDB Atlas Flex
- Object storage for evidence
- No Kubernetes
- No Redis unless a measured requirement appears

### Testing

- Playwright
- TypeScript compiler
- ESLint

---

## 4. Pilot Infrastructure Constraint

Target Pilot infrastructure budget:

**≤ 1,500 THB/month**

Preferred operating target:

**~1,200 THB/month or less**

Do not introduce paid infrastructure unless there is a concrete requirement.

During Pilot, avoid adding:

- Kubernetes
- dedicated Redis
- message brokers
- unnecessary microservices
- dedicated map infrastructure
- self-hosted MongoDB clusters

Add infrastructure only after metrics demonstrate the need.

---

## 5. Map Architecture

The map engine is **MapLibre GL JS**.

React integration should use:

```ts
import Map from "react-map-gl/maplibre";
```

Import MapLibre CSS:

```ts
import "maplibre-gl/dist/maplibre-gl.css";
```

The map must support:

- street basemap
- satellite basemap
- hybrid basemap
- GPS current location
- click/tap to place marker
- draggable marker
- location accuracy visualization
- future GeoJSON layers
- future clustering
- future heatmaps
- future polygons and investigation overlays

Do not use Google Maps unless explicitly requested.

Do not bind the application architecture tightly to a single map tile provider.

Create a provider abstraction so satellite providers can be replaced later.

---

## 6. Basemap Modes

Support these modes:

```ts
type MapMode = "street" | "satellite" | "hybrid";
```

Recommended behavior:

- `street` — navigation and road context
- `satellite` — physical terrain/buildings
- `hybrid` — satellite imagery with labels and roads

For citizen location confirmation, `hybrid` may be the most useful mode.

The selected basemap must not change the report coordinates.

---

## 7. GPS Rules

Use the browser Geolocation API directly.

Do not add a GPS wrapper library unless there is a demonstrated requirement.

Example:

```ts
navigator.geolocation.getCurrentPosition(
  onSuccess,
  onError,
  {
    enableHighAccuracy: true,
    timeout: 10_000,
    maximumAge: 0,
  }
);
```

GPS access generally requires HTTPS, except localhost.

Handle these cases distinctly:

- permission denied
- geolocation unavailable
- timeout
- insecure context / HTTPS requirement
- browser does not support geolocation

Do not tell the user "permission denied" when the real cause is an insecure context.

GPS coordinates are not automatically the incident coordinates.

A citizen may be reporting an incident that occurred elsewhere.

Users must always be able to manually adjust the location.

---

## 8. Location Interaction Flow

Preferred citizen flow:

```text
Open report form
      ↓
Describe the issue
      ↓
Choose incident location
      ↓
[Use current GPS] OR [Tap map]
      ↓
Marker appears
      ↓
User may drag marker
      ↓
Confirm location
      ↓
Attach evidence
      ↓
Submit
```

Required interactions:

- GPS → place marker
- tap map → place/move marker
- drag marker → update coordinates
- GPS failure → manual map selection remains available

Never make GPS permission mandatory for submitting a report.

---

## 9. Location Provenance

Always preserve how a location was obtained.

Recommended structure:

```ts
type LocationSource =
  | "gps"
  | "map_click"
  | "marker_drag";

type ReportLocation = {
  type: "Point";
  coordinates: [number, number];
};

type LocationMeta = {
  source: LocationSource;
  accuracyMeters?: number;
  capturedAt?: Date;
};
```

Coordinates must be stored as:

```text
[longitude, latitude]
```

Never store GeoJSON as `[latitude, longitude]`.

Example:

```json
{
  "location": {
    "type": "Point",
    "coordinates": [101.2807, 6.4255]
  },
  "locationMeta": {
    "source": "gps",
    "accuracyMeters": 8.2
  }
}
```

---

## 10. MongoDB Geospatial Rules

Use GeoJSON for all spatial data.

Example report location:

```json
{
  "type": "Point",
  "coordinates": [101.2807, 6.4255]
}
```

Create a `2dsphere` index:

```js
db.reports.createIndex({
  location: "2dsphere"
});
```

Use MongoDB geospatial operators where appropriate:

- `$near`
- `$nearSphere`
- `$geoWithin`
- `$geoIntersects`

Do not implement geographic distance filtering manually in JavaScript if MongoDB can perform the query.

---

## 11. Suggested Report Model

Example domain shape:

```ts
interface CitizenReport {
  _id: ObjectId;

  category: string;
  description: string;

  location: {
    type: "Point";
    coordinates: [number, number];
  };

  locationMeta: {
    source: "gps" | "map_click" | "marker_drag";
    accuracyMeters?: number;
    capturedAt?: Date;
  };

  province?: string;
  district?: string;
  subdistrict?: string;

  attachments: Array<{
    type: "image" | "document";
    url: string;
    storageKey: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;

  status:
    | "raw"
    | "claim"
    | "verified"
    | "derived"
    | "hypothesis";

  createdAt: Date;
  updatedAt: Date;
}
```

Prefer additive evolution of this schema.

Avoid destructive schema migrations during Pilot unless necessary.

---

## 12. Evidence / Image Storage

Uploaded images must go to object storage.

MongoDB stores only metadata and references.

Example:

```json
{
  "attachments": [
    {
      "type": "image",
      "url": "https://...",
      "storageKey": "reports/<report-id>/image-1.webp"
    }
  ]
}
```

Compress images before or during upload.

Recommended target:

- max image dimension around 1920 px
- WebP or JPEG
- quality around 75–85%
- retain enough detail for verification

Do not expose private storage keys unnecessarily.

---

## 13. Privacy and Safety

Citizen GPS data is sensitive.

Do not expose exact citizen/report GPS publicly by default.

Separate:

```text
exact_location
```

from:

```text
public_location
```

if public maps are introduced.

Possible public-location strategies:

- reduced coordinate precision
- spatial jitter
- aggregation to grid/hex cell
- neighborhood-level representation
- hide exact location entirely for sensitive report types

Never include reporter identity, exact home location, phone number, or private evidence in a public API response unless explicitly authorized.

Treat uploads as untrusted input.

Validate:

- MIME type
- file extension
- file size
- image dimensions where applicable

Do not trust client-provided metadata.

---

## 14. Mobile-First Requirement

The `/report` page is citizen-facing and must be mobile-first.

It must work at approximately:

```text
320 px
390 px
430 px
```

Avoid fixed desktop widths such as:

```css
min-width: 1180px;
```

Citizen-facing pages must not require horizontal page scrolling.

Preferred responsive design:

```text
Mobile
┌─────────────────────┐
│ Report form         │
├─────────────────────┤
│ Map                 │
├─────────────────────┤
│ Photos              │
├─────────────────────┤
│ Submit              │
└─────────────────────┘

Desktop
┌───────────────┬──────────────┐
│ Form          │ Map          │
│               │              │
└───────────────┴──────────────┘
```

Touch controls should generally be at least ~44 px high.

Inputs should use mobile-safe font sizing.

---

## 15. Map Performance Rules

For one editable citizen marker, a React `<Marker>` component is acceptable.

For many reports, do **not** render thousands of React Marker components.

Prefer:

```text
MongoDB query
    ↓
GeoJSON FeatureCollection
    ↓
MapLibre Source
    ↓
MapLibre Layer
```

Use MapLibre layers for:

- large point datasets
- clustering
- heatmaps
- polygons
- verified-event overlays

Use client-side map bounding box queries instead of loading all historical reports at once.

---

## 16. API Design

Use Next.js Route Handlers for Pilot.

Example endpoints:

```text
POST   /api/reports
GET    /api/reports/:id
GET    /api/reports?bbox=...
PATCH  /api/reports/:id
POST   /api/reports/:id/attachments
```

All API payloads must be validated with Zod.

Example:

```ts
const locationSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
});
```

Never pass raw request bodies directly into MongoDB.

Explicitly select fields.

---

## 17. Validation Rules

At minimum validate:

### Longitude

```text
-180 ≤ longitude ≤ 180
```

### Latitude

```text
-90 ≤ latitude ≤ 90
```

### Accuracy

Must be non-negative if present.

### Description

Apply reasonable maximum length.

### Attachments

Validate count and maximum file size.

### Category

Use a controlled enum or category identifier.

---

## 18. Security Rules

Never commit:

- `.env`
- MongoDB credentials
- API secrets
- storage secret keys
- map provider private keys
- service tokens

Use environment variables.

Example:

```env
MONGODB_URI=
MONGODB_DB=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
NEXT_PUBLIC_MAP_STYLE_URL=
```

Only variables intentionally safe for browser exposure may use `NEXT_PUBLIC_`.

Do not expose MongoDB connection strings to the browser.

---

## 19. Testing Strategy

Use Playwright for browser behavior.

Required mobile viewport test:

```ts
test.use({
  viewport: {
    width: 390,
    height: 844,
  },
});
```

GPS can be simulated:

```ts
await context.grantPermissions(["geolocation"]);

await context.setGeolocation({
  latitude: 6.4255,
  longitude: 101.2807,
});
```

Required E2E scenarios:

### Responsive

- `/report` at 390 px has no horizontal page scroll
- map remains usable
- form controls remain accessible

### GPS success

- user grants geolocation permission
- application receives coordinates
- marker is placed
- form/state contains the expected coordinates

### GPS denied

- clear permission message appears
- manual map selection remains functional

### GPS unavailable / timeout

- clear error state
- report can still be completed manually

### Map

- tapping map moves marker
- dragging marker updates coordinates
- switching basemap does not change coordinates

### Submission

- valid report is submitted
- invalid coordinates are rejected
- attachments are referenced correctly

---

## 20. Build and Quality Checks

Before merge, run when possible:

```bash
npm run lint
npx tsc --noEmit
npm run build
npx playwright test
```

If the global build is already broken by an unrelated existing file:

1. document the existing failure
2. do not falsely attribute it to the current feature
3. run the most targeted checks possible for modified files
4. do not silently modify unrelated staged files

Keep changes scoped to the requested feature.

---

## 21. Git / PR Discipline

When working on a feature:

- inspect the existing implementation before changing architecture
- avoid unrelated formatting churn
- preserve staged changes that predate the task
- explain pre-existing build failures separately
- add tests for behavior introduced by the feature
- do not rewrite unrelated modules merely to make the diff look cleaner

PR review should explicitly call out:

- mobile risk
- GPS behavior
- HTTPS requirement
- map provider requirements
- satellite licensing/provider assumptions
- browser coverage
- build blockers
- missing E2E coverage

---

## 22. Satellite Map Rules

Satellite imagery is a basemap provider concern, not application-domain logic.

Implement the application so that the provider can be replaced.

Example conceptual interface:

```ts
type BasemapConfig = {
  id: "street" | "satellite" | "hybrid";
  label: string;
  style: string | object;
};
```

Do not hard-code a temporary demo satellite source throughout components.

Centralize provider configuration.

Never use satellite imagery without checking its licensing and production usage terms.

---

## 23. Redis Policy

Redis is **not required during Pilot**.

Do not add Redis merely because it is common in production architectures.

Introduce Redis only when metrics show a real need, such as:

- repeated expensive map queries
- distributed rate limiting
- job queues
- distributed locks
- high-volume temporary state
- cache pressure

MongoDB remains the source of truth.

Redis must never become the authoritative store for citizen reports.

---

## 24. Kubernetes Policy

Do not introduce Kubernetes during Pilot.

Kubernetes becomes reasonable only if there is a demonstrated requirement such as:

- many long-running workers
- heavy ingestion pipelines
- self-hosted ML workloads
- sustained high compute
- custom networking
- multiple independently deployed services
- organizational infrastructure requirements

Do not adopt Kubernetes solely for hypothetical future scale.

---

## 25. Future Spatial Analytics

The architecture should allow future addition of:

- report clustering
- density heatmaps
- timeline playback
- polygon analysis
- radius searches
- incident proximity analysis
- spatial correlations
- H3 aggregation
- Turf.js computations
- deck.gl GPU visualization
- data-source confidence overlays

These are future capabilities.

Do not add them to citizen-reporting screens unless explicitly requested.

---

## 26. Data Lifecycle

Every data transformation should preserve provenance.

Conceptual flow:

```text
Citizen submission
      ↓
RAW
      ↓
Claim
      ↓
Verification
      ↓
Verified Fact
      ↓
Derived information
      ↓
Hypothesis
```

Do not present claims as verified facts.

Derived analytics must reference their source data.

Hypotheses must remain distinguishable from verified information.

---

## 27. Engineering Decision Principle

Prefer the smallest architecture that safely supports the current validated requirement.

When choosing between:

```text
simple + measurable
```

and:

```text
complex + theoretically scalable
```

choose the simple option during Pilot.

Optimize after observing real usage.

Important metrics include:

- reports/day
- daily active users
- images/report
- storage growth/month
- MongoDB size
- map sessions
- API latency
- geospatial query latency
- report submission failure rate
- GPS permission-denial rate

---

## 28. Current Recommended Pilot Stack

```text
Next.js
TypeScript
Tailwind CSS
React Hook Form
Zod

react-map-gl
MapLibre GL JS
Browser Geolocation API
GeoJSON

Vercel
MongoDB Atlas Flex
Cloudflare R2 / S3-compatible object storage

Playwright
```

Optional later:

```text
Turf.js
H3
deck.gl
Redis
background workers
Kubernetes
```

Add optional components only when required.

---

## 29. Definition of Done — Citizen GPS Report

A GPS reporting feature is not complete until:

- [ ] `/report` works at 390 px width
- [ ] there is no page-level horizontal scrolling
- [ ] GPS permission success is handled
- [ ] GPS denial is handled
- [ ] GPS timeout/unavailable is handled
- [ ] HTTPS requirement is communicated correctly
- [ ] user can tap the map to place a marker
- [ ] user can drag the marker
- [ ] coordinates update after marker movement
- [ ] GeoJSON uses `[longitude, latitude]`
- [ ] location source is stored
- [ ] GPS accuracy is stored when available
- [ ] street/satellite/hybrid switching works
- [ ] basemap switching does not alter coordinates
- [ ] images are uploaded to object storage
- [ ] MongoDB stores attachment metadata only
- [ ] `2dsphere` index exists
- [ ] exact sensitive GPS is not exposed publicly
- [ ] mobile Playwright test exists
- [ ] GPS Playwright test exists
- [ ] lint/type checks pass for changed code
- [ ] unrelated existing build failures are documented separately

---

## 30. Instructions for AI Coding Agents

When modifying this project:

1. Read existing code before proposing architecture changes.
2. Preserve existing behavior unless the request explicitly changes it.
3. Prefer incremental changes over rewrites.
4. Keep citizen-facing UX mobile-first.
5. Preserve location provenance.
6. Use GeoJSON consistently.
7. Do not expose sensitive GPS data.
8. Do not introduce unnecessary infrastructure.
9. Add Playwright coverage for new browser interactions.
10. Report existing unrelated failures separately from new regressions.
11. Do not modify unrelated staged files.
12. Explain trade-offs when adding a new paid service.
13. Keep Pilot monthly infrastructure cost under the stated budget unless the user explicitly approves an increase.
14. Treat satellite imagery as replaceable infrastructure.
15. Optimize for trustworthy data, not just feature completion.

---

## 31. Core Principle

This platform is not merely a map with pins.

It is a system for collecting claims about real-world events while preserving:

- where the information came from
- how the location was determined
- what evidence supports it
- how confident the system should be
- whether the information has been verified

Every engineering decision should protect that distinction.

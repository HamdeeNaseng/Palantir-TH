# AGENT.md — Citizen Geo Report Platform

## 1. Mission

You are an AI coding agent working on a mobile-first citizen reporting and geospatial investigation platform for the four southern border provinces of Thailand.

Your responsibility is not only to make features work. You must preserve:

- data provenance
- location accuracy
- citizen privacy
- mobile usability
- geospatial consistency
- operational simplicity
- low Pilot infrastructure cost
- testability
- separation between claims and verified facts

Core data lifecycle:

```text
Raw → Claim → Verified Fact → Derived → Hypothesis
```

Never collapse these stages into one generic approval state.

---

## 2. Engineering Priorities

Prioritize in this order:

1. Citizen-facing mobile usability
2. Correct GPS and map behavior
3. Privacy and safe handling of location data
4. Data integrity and provenance
5. Simple architecture
6. Production-quality frontend implementation
7. Test coverage
8. Performance
9. Future scalability

Do not optimize for hypothetical scale before usage metrics show the need.

---

## 3. Current Stack

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
- Street / Satellite / Hybrid basemaps

### Database

- MongoDB Atlas
- MongoDB Native Driver preferred
- GeoJSON
- `2dsphere` indexes

### File Storage

- Cloudflare R2 or S3-compatible object storage

Do not store image binary data directly in MongoDB.

### Hosting — Pilot

- Vercel
- MongoDB Atlas Flex
- Object storage
- No Kubernetes
- No Redis unless metrics show a real need

### Testing

- Playwright
- ESLint
- TypeScript compiler

---

## 4. Skills

Skills are this repository's shared expert knowledge. Treat them the way a senior engineer treats an internal handbook: load the relevant skill **before** writing code, not after review.

### 4.1 Where Skills Live

```text
.agents/skills/      source of truth, committed
skills-lock.json     pinned source + content hash for every vendored skill
.claude/skills/      generated copy the agent runtime reads (gitignored)
```

Rules:

- edit skills only in `.agents/skills/`
- `.claude/skills/` is a mirror; changes made only there are lost on a clean checkout
- every vendored skill must have a matching entry in `skills-lock.json`
- `citizen-geo-report` and `agent-commit` are project-local and intentionally have no lock entry

### 4.2 Installed Skills

Project-local:

| Skill | Use for |
| --- | --- |
| `citizen-geo-report` | project domain: citizen reporting, provenance, geo rules |
| `agent-commit` | branching, commit messages, quality gates, PR body, merge rules |

Vendored (`skills-lock.json`):

| Skill | Use for | Source |
| --- | --- | --- |
| `modern-web-guidance` | current Web Platform behavior (CSS, DOM, browser APIs) | `GoogleChrome/modern-web-guidance` |
| `frontend-design` | visual direction and typography for new UI | `anthropics/skills` |
| `web-design-guidelines` | UX / accessibility audit of existing UI | `vercel-labs/agent-skills` |
| `vercel-composition-patterns` | component architecture, replacing boolean-prop sprawl | `vercel-labs/agent-skills` |
| `vercel-react-best-practices` | React / Next.js performance and server-client boundaries | `vercel-labs/agent-skills` |
| `vercel-react-view-transitions` | route/state transition animation, only when requested | `vercel-labs/agent-skills` |
| `vercel-optimize` | Vercel cost and route-level performance audits | `vercel-labs/agent-skills` |
| `deploy-to-vercel` | preview and production deployments | `vercel-labs/agent-skills` |
| `vercel-cli-with-tokens` | non-interactive Vercel CLI / env var management | `vercel-labs/agent-skills` |
| `mongodb-schema-design` | data modeling, embed vs reference, lifecycle/TTL | `mongodb/agent-skills` |
| `mongodb-query-optimizer` | slow queries, index design, `explain` analysis | `mongodb/agent-skills` |
| `mongodb-connection` | driver client config, pooling in serverless routes | `mongodb/agent-skills` |
| `playwright-skill` | E2E test authoring, mobile viewports, GPS emulation | `LambdaTest/agent-skills` |
| `writing-guidelines` | docs and prose review | `vercel-labs/agent-skills` |
| `chrome-extensions` | dormant — no extension in this repository | `GoogleChrome/modern-web-guidance` |
| `vercel-react-native-skills` | dormant — this is a mobile-first web app, not React Native | `vercel-labs/agent-skills` |

Dormant skills stay installed but must not be loaded for normal work. Remove them if they are still unused at the end of Pilot.

### 4.3 Routing — Which Skill For Which Task

```text
touching /report or any citizen screen
    → citizen-geo-report + modern-web-guidance

new UI surface, no design decided yet
    → frontend-design → then modern-web-guidance

existing UI feels wrong or inaccessible
    → web-design-guidelines

component grew booleans / prop sprawl
    → vercel-composition-patterns

slow page, large bundle, rerender storm
    → vercel-react-best-practices

new collection, field, or status model
    → mongodb-schema-design

slow geospatial query, index question
    → mongodb-query-optimizer

route handler creating a Mongo client
    → mongodb-connection

new browser behavior to cover
    → playwright-skill

shipping a preview or production build
    → deploy-to-vercel (+ vercel-cli-with-tokens for env/token work)

infrastructure cost or latency review
    → vercel-optimize

editing README.md / AGENT.md / docs
    → writing-guidelines

committing, branching, or opening a PR
    → agent-commit
```

Load the narrowest skill that covers the task. Two or three skills for one change is normal; loading everything is not.

### 4.4 Precedence

When guidance conflicts, resolve in this order:

```text
1. AGENT.md (this file)
2. citizen-geo-report and agent-commit (project skills)
3. domain skills (mongodb-*, playwright-skill)
4. general guidance skills (vercel-*, frontend-design, modern-web-guidance)
```

A vendored skill never overrides a project rule. If a skill recommends something this file forbids — extra infrastructure, a paid service, exposing exact GPS — follow this file and note the conflict in the PR description.

### 4.5 Managing Skills

Add:

```bash
npx skills add <owner>/<repo>
```

Commit `.agents/skills/<name>/` and the new `skills-lock.json` entry together, in a commit that touches nothing else.

Update:

```bash
npx skills update <name>
```

Review the diff before committing. The `computedHash` change in `skills-lock.json` is the review surface — a hash that moves without a reviewed content diff is a supply-chain risk, not a formality.

Remove: delete the skill directory and its lockfile entry in the same commit.

Author a project-local skill only when the knowledge is specific to this platform and would otherwise be re-explained in every task. Required shape:

```yaml
---
name: kebab-case-name
description: >
  What it covers, plus the concrete triggers that should load it.
---
```

Without that frontmatter the skill is discoverable by name only, and the agent will not know when to load it.

Do not:

- edit a vendored skill in place — it silently drifts from its recorded hash; fork it as a project-local skill instead
- duplicate AGENT.md content into a skill, or the reverse
- put secrets, tokens, connection strings, or citizen data in a skill
- add a skill for a technology this repository does not use

### 4.6 Agent Discipline

1. Check the routing table before starting, and state which skills you loaded.
2. Load skills before implementation, not as post-hoc justification.
3. Prefer a skill over recalled knowledge for anything version-sensitive: Web Platform APIs, React 19 / Next 15 behavior, MongoDB operators and geospatial stages, Playwright APIs.
4. If a skill's guidance is stale relative to the installed dependency versions, follow the dependencies and say so explicitly.
5. Never invent a skill name. If routing is unclear, ask.

---

## 5. Mobile-First Rules

The `/report` page is citizen-facing and must work well at:

```text
320px
390px
430px
```

Do not use fixed desktop-only layout constraints such as:

```css
min-width: 1180px;
```

Requirements:

- no page-level horizontal scrolling
- controls usable with one hand
- touch targets around 44×44 CSS px or larger
- readable form labels
- map remains usable on narrow screens
- mobile-safe input font sizing
- clear loading/error states

Citizen UI must remain simpler than analyst/investigation UI.

---

## 6. Citizen Report Flow

Preferred flow:

```text
Open report form
      ↓
Select category
      ↓
Describe incident
      ↓
Choose location
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

GPS permission must never be mandatory for submitting a report.

Manual map placement must always remain available.

### Anti-abuse

The form is anonymous and unauthenticated, so two checks stand in front of the
`submitCitizenReport` server action, in this order:

1. **Honeypot** (`organization`, `lib/report-form.ts`) — filled means a bot;
   the action returns a fake success and writes nothing.
2. **reCAPTCHA v3** (`server/recaptcha-verify.ts`) — the token is minted at
   submit time by `useRecaptcha` and verified against Google's `siteverify`.

The captcha's failure modes are deliberate and must be preserved:

- **No `RECAPTCHA_SECRET_KEY`** → the check is skipped entirely, so a fresh
  clone, CI, and the Playwright suite behave exactly as they did before it
  existed. With no `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, no captcha code even
  reaches the client bundle and nothing is requested from Google.
- **Google unreachable** → fail open, with a `console.warn`. An outage at
  Google must not silence citizen reports.
- **Token present but judged bad** (invalid, wrong action, or below
  `RECAPTCHA_MIN_SCORE`, default 0.5) → the only case that rejects a
  submission.

The score is stored on `citizen_reports.captcha_score` so the threshold can be
tuned against real traffic. Absent means "not measured", never "suspicious".

Rate limiting remains out of scope — see the Redis policy in §24.

---

## 7. GPS Rules

Use the Browser Geolocation API directly.

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

Do not add a geolocation wrapper library unless there is a demonstrated requirement.

Handle these states distinctly:

- permission denied
- unavailable
- timeout
- unsupported browser
- insecure context / HTTPS requirement

Do not show “permission denied” when the real problem is HTTP/insecure context.

GPS position is the device position, not necessarily the incident position. Users must be able to correct the incident point manually.

---

## 8. Location Provenance

Always preserve how coordinates were obtained.

```ts
type LocationSource =
  | "gps"
  | "map_click"
  | "marker_drag";
```

Recommended shape:

```ts
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

GeoJSON coordinates must always be:

```text
[longitude, latitude]
```

Never:

```text
[latitude, longitude]
```

---

## 9. Map Rules

Use MapLibre GL JS via `react-map-gl/maplibre`.

The map must support:

- current GPS location
- tap/click to place marker
- draggable marker
- GPS accuracy visualization
- street basemap
- satellite basemap
- hybrid basemap
- future GeoJSON overlays
- future clustering
- future heatmaps
- future polygons

Do not bind application logic to one commercial map provider.

Basemap provider configuration must be centralized and replaceable.

Switching basemaps must never change incident coordinates.

---

## 10. Map Component Architecture

Prefer composition.

Example:

```text
ReportLocationPicker
├── GPSButton
├── BasemapSwitcher
├── MapCanvas
├── EditableMarker
├── AccuracyIndicator
└── LocationStatus
```

Avoid giant components controlled by many booleans.

Prefer explicit variants and composed subcomponents.

---

## 11. MongoDB Geospatial Rules

Use GeoJSON for spatial data.

```json
{
  "location": {
    "type": "Point",
    "coordinates": [101.2807, 6.4255]
  }
}
```

Create a `2dsphere` index:

```js
db.reports.createIndex({
  location: "2dsphere"
});
```

Use MongoDB geospatial operators when appropriate:

- `$near`
- `$nearSphere`
- `$geoWithin`
- `$geoIntersects`

Do not reimplement geographic filtering in browser JavaScript when MongoDB can perform it correctly.

---

## 12. Report Schema Direction

Recommended model:

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

Prefer additive schema evolution during Pilot.

---

## 13. Validation Rules

Validate all API input with Zod.

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

Validate at minimum:

- longitude: `-180..180`
- latitude: `-90..90`
- accuracy is non-negative
- controlled category values
- description maximum length
- attachment count
- MIME type
- file size

Never pass raw request bodies directly into MongoDB.

Explicitly select validated fields.

---

## 14. Evidence Storage

Images and documents belong in object storage.

MongoDB stores only references and metadata.

Recommended image handling:

```text
Original
   ↓
resize max ~1920px
   ↓
WebP/JPEG
   ↓
quality ~75–85%
```

Retain enough detail for evidence review.

Treat uploaded files as untrusted input.

---

## 15. Privacy Rules

Exact citizen/report GPS is sensitive.

Do not expose exact GPS publicly by default.

When public maps are added, distinguish:

```text
exact_location
```

from:

```text
public_location
```

Possible public-location strategies:

- reduced coordinate precision
- spatial jitter
- grid/H3 aggregation
- neighborhood-level display
- hide exact point for sensitive categories

Never expose by default:

- reporter identity
- phone number
- home address
- exact private GPS
- private evidence
- internal verification notes

---

## 16. Data Lifecycle Rules

The system distinguishes:

```text
Raw
↓
Claim
↓
Verified Fact
↓
Derived
↓
Hypothesis
```

Rules:

- raw submissions are not facts
- claims are not automatically verified
- derived analytics must reference source records
- hypotheses must remain distinguishable from verified information
- provenance must survive transformations

Do not reduce this model to a generic `approved` status.

---

## 17. API Architecture

For Pilot, prefer Next.js Route Handlers.

Example endpoints:

```text
POST   /api/reports
GET    /api/reports/:id
GET    /api/reports?bbox=...
PATCH  /api/reports/:id
POST   /api/reports/:id/attachments
```

Keep APIs explicit and validated.

---

## 18. Map Performance Rules

For one editable citizen marker, React `<Marker>` is acceptable.

For many reports, do not render thousands of React markers.

Prefer:

```text
MongoDB
   ↓
GeoJSON FeatureCollection
   ↓
MapLibre Source
   ↓
MapLibre Layer
```

Use layers for:

- report points
- clusters
- heatmaps
- polygons
- verified-event overlays

Prefer viewport/bounding-box queries instead of loading all historical data at once.

---

## 19. Frontend Performance Rules

Map rendering is expensive. Keep client JavaScript deliberate.

Prefer:

- avoid unnecessary `"use client"`
- dynamic loading of heavy map UI where appropriate
- minimize bundle size
- avoid unnecessary rerenders
- lazy-load images
- compress uploads
- load map data by viewport
- keep server/client boundaries intentional

Do not add memoization everywhere without a reason.

---

## 20. Accessibility Rules

Citizen flows must remain accessible.

Requirements:

- visible labels
- keyboard-operable controls
- visible focus state
- accessible names for map controls
- clear loading/error states
- sufficient contrast
- no critical information conveyed only by color
- status/error feedback announced appropriately where needed

---

## 21. Visual Direction

Citizen UI should be:

- clean
- minimal
- professional
- map-first
- high-clarity
- restrained

Avoid:

- generic admin dashboard styling
- excessive cards
- gratuitous gradients
- neon sci-fi decoration
- dense analyst metadata in citizen views
- animation without purpose

Citizen UI and analyst UI are different experiences.

---

## 22. Error Handling

Important async actions should have explicit states:

```text
idle
loading
success
error
```

GPS should distinguish:

```text
locating
success
permission_denied
timeout
unavailable
insecure_context
unsupported
```

Errors should tell the user what to do next.

Example:

```text
ไม่สามารถอ่านตำแหน่งปัจจุบันได้
คุณยังสามารถแตะแผนที่เพื่อระบุตำแหน่งเหตุการณ์ได้
```

---

## 23. Pilot Infrastructure Constraint

Target monthly infrastructure cost:

```text
≤ 1,500 THB/month
```

Preferred operating target:

```text
~1,200 THB/month or less
```

Current Pilot direction:

```text
Vercel
MongoDB Atlas Flex
Cloudflare R2
MapLibre GL
```

Do not add paid infrastructure without a current, measurable requirement.

---

## 24. Redis Policy

Redis is optional during Pilot.

Add it only when metrics demonstrate need for:

- rate limiting
- repeated expensive queries
- job queues
- distributed locks
- shared temporary state
- meaningful cache pressure

MongoDB remains the source of truth.

---

## 25. Kubernetes Policy

Do not introduce Kubernetes during Pilot.

Consider Kubernetes only if requirements include:

- multiple independently deployed services
- long-running workers
- sustained compute
- heavy ingestion pipelines
- self-hosted ML workloads
- custom networking
- organizational infrastructure constraints

Do not use Kubernetes solely for hypothetical scale.

---

## 26. Playwright Requirements

Use Playwright for real browser interaction tests.

Mobile viewport example:

```ts
test.use({
  viewport: {
    width: 390,
    height: 844,
  },
});
```

GPS simulation:

```ts
await context.grantPermissions(["geolocation"]);

await context.setGeolocation({
  latitude: 6.4255,
  longitude: 101.2807,
});
```

Required E2E coverage:

### Responsive

- `/report` works at 390 px
- no horizontal page scroll
- map remains usable
- form remains accessible

### GPS success

- permission granted
- coordinates received
- marker appears
- state/form contains expected coordinates

### GPS denied

- clear permission message
- manual map selection still works

### GPS unavailable / timeout

- clear fallback
- report can still be completed

### Map

- tap moves marker
- drag changes coordinates
- basemap switching preserves coordinates

### Submission

- valid report succeeds
- invalid coordinates are rejected
- attachment references are valid

---

## 27. Quality Gates

Before merge, run when possible:

```bash
npm run lint
npx tsc --noEmit
npm run build
npx playwright test
```

If the global build is broken by a pre-existing unrelated file:

1. identify the existing failure clearly
2. do not attribute it to the current feature
3. run targeted checks for changed code
4. do not silently modify unrelated staged files

---

## 28. Git / PR Discipline

The binding rules are `mockup/Protocal Commit.md`, applied through the
`agent-commit` skill. Load it before any commit, branch, or PR.

When implementing a feature:

- inspect existing code first
- keep diffs scoped
- avoid unrelated formatting churn
- preserve pre-existing staged changes
- do not rewrite unrelated modules silently
- add tests for new browser behavior
- document known limitations
- separate pre-existing failures from new regressions

PR review should explicitly call out:

- mobile risk
- GPS behavior
- HTTPS requirement
- map provider assumptions
- satellite licensing
- missing E2E coverage
- build/test blockers
- privacy risk

---

## 29. Satellite Imagery Rules

Satellite imagery is infrastructure, not domain logic.

Use replaceable basemap configuration.

```ts
type BasemapConfig = {
  id: "street" | "satellite" | "hybrid";
  label: string;
  style: string | object;
};
```

Do not hard-code temporary tile URLs across components.

Always check:

- licensing
- production usage terms
- attribution
- rate limits

---

## 30. Future Spatial Analytics

The architecture should allow future addition of:

- clustering
- heatmaps
- timeline playback
- radius search
- polygon filtering
- spatial correlation
- H3 aggregation
- Turf.js
- deck.gl

Do not add these to citizen-facing screens unless explicitly requested.

---

## 31. Decision Framework

When choosing between:

```text
simple + measurable
```

and:

```text
complex + theoretically scalable
```

choose the simpler architecture during Pilot.

Before introducing a service, ask:

1. What current problem does it solve?
2. What metric demonstrates the problem?
3. What operational burden does it add?
4. What monthly cost does it add?
5. Can the existing stack solve it first?

---

## 32. Metrics to Observe

Track:

- reports/day
- active users/day
- images/report
- image storage growth/month
- MongoDB size
- API latency
- map sessions
- geospatial query latency
- report submission failure rate
- GPS permission-denial rate
- upload failure rate

Scale based on observed data.

---

## 33. Definition of Done — Citizen GPS Report

A GPS reporting feature is complete only when:

- [ ] `/report` works at 390 px width
- [ ] no page-level horizontal scrolling
- [ ] GPS success works
- [ ] GPS denial works
- [ ] GPS timeout/unavailable works
- [ ] HTTPS requirement is explained correctly
- [ ] user can tap map to place marker
- [ ] user can drag marker
- [ ] coordinates update after drag
- [ ] GeoJSON uses `[longitude, latitude]`
- [ ] location source is stored
- [ ] GPS accuracy is stored when available
- [ ] street/satellite/hybrid modes work
- [ ] basemap switching preserves coordinates
- [ ] images go to object storage
- [ ] MongoDB stores attachment metadata only
- [ ] `2dsphere` index exists
- [ ] exact sensitive GPS is not exposed publicly
- [ ] mobile Playwright coverage exists
- [ ] GPS Playwright coverage exists
- [ ] changed code passes lint/type checks
- [ ] unrelated build failures are documented separately

---

## 34. Rules for AI Coding Agents

When modifying this repository:

1. Load the skills the routing table in Section 4.3 points to before starting.
2. Read existing code before changing architecture.
3. Keep changes incremental and scoped.
4. Preserve existing behavior unless the task explicitly changes it.
5. Keep citizen UX mobile-first.
6. Preserve GPS provenance.
7. Use GeoJSON consistently.
8. Protect exact citizen location.
9. Keep MongoDB as the source of truth.
10. Keep uploaded files outside MongoDB.
11. Prefer composed components over boolean-heavy components.
12. Add Playwright coverage for browser interactions.
13. Separate pre-existing failures from new regressions.
14. Never expose private environment variables to client code.
15. Explain trade-offs before adding paid services.
16. Keep Pilot cost within budget unless explicitly approved.
17. Treat satellite providers as replaceable infrastructure.
18. Optimize after measuring real usage.
19. Never present a citizen claim as a verified fact.
20. Preserve provenance across transformations.
21. Prefer trustworthy data over feature count.

---

## 35. Core Principle

This project is not just a map with pins.

It is a system for collecting claims about real-world events while preserving:

- where the information came from
- how the location was determined
- what evidence supports it
- how accurate the location may be
- whether the information has been verified
- what later analysis was derived from it

Every engineering decision should preserve that distinction.

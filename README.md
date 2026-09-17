<div align="center">

<!-- Animated title using SVG -->
[![Typing SVG](https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=800&size=42&duration=3000&pause=1000&color=FF4500&center=true&vCenter=true&width=800&height=80&lines=DEADNET;CAPTURE+THE+FLAG+PLATFORM;THE+VOID+IS+WAITING)](https://git.io/typing-svg)

<img src="https://img.shields.io/badge/STATUS-GHOSTED-FF4500?style=for-the-badge&labelColor=0A0A0F&color=FF4500&logo=statuspage&logoColor=FF4500"/>
<img src="https://img.shields.io/badge/VERSION-1.0.0-FF6B00?style=for-the-badge&labelColor=0A0A0F"/>
<img src="https://img.shields.io/badge/CLEARANCE-???-FF2D2D?style=for-the-badge&labelColor=0A0A0F"/>

<br/>

[![DEADNET LIVE](https://img.shields.io/badge/DEADNET-LIVE%20DEPLOYMENT-FF4500?style=for-the-badge&labelColor=0A0A0F&logo=railway&logoColor=FF4500)](https://deadnet-production.up.railway.app/)

<br/>

<!-- Animated wave separator -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=FF4500&height=80&section=header&reversal=false&textBg=false" width="100%"/>

</div>

```
  ██████╗ ███████╗ █████╗ ██████╗ ███╗   ██╗███████╗████████╗
  ██╔══██╗██╔════╝██╔══██╗██╔══██╗████╗  ██║██╔════╝╚══██╔══╝
  ██║  ██║█████╗  ███████║██║  ██║██╔██╗ ██║█████╗     ██║   
  ██║  ██║██╔══╝  ██╔══██║██║  ██║██║╚██╗██║██╔══╝     ██║   
  ██████╔╝███████╗██║  ██║██████╔╝██║ ╚████║███████╗   ██║   
  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═══╝╚══════╝   ╚═╝   

  > CONNECTION ESTABLISHED
  > LOCATION: UNKNOWN
  > STATUS: DOWN
```

<div align="center">

[![Typing SVG](https://readme-typing-svg.demolab.com?font=JetBrains+Mono&size=16&duration=2000&pause=500&color=6B6B85&center=true&vCenter=true&multiline=true&width=700&height=60&lines=A+full-stack+CTF+competition+platform+built+for+academia;Local+events.+Major+events.+Inter-organization+warfare.)](https://git.io/typing-svg)

</div>

<br/>

<!-- Animated stats bar -->
<div align="center">
<img src="https://img.shields.io/badge/React-0A0A0F?style=for-the-badge&logo=react&logoColor=FF4500"/>
<img src="https://img.shields.io/badge/FastAPI-0A0A0F?style=for-the-badge&logo=fastapi&logoColor=FF4500"/>
<img src="https://img.shields.io/badge/PostgreSQL-0A0A0F?style=for-the-badge&logo=postgresql&logoColor=FF4500"/>
<img src="https://img.shields.io/badge/Redis-0A0A0F?style=for-the-badge&logo=redis&logoColor=FF4500"/>
<img src="https://img.shields.io/badge/Docker-0A0A0F?style=for-the-badge&logo=docker&logoColor=FF4500"/>
<img src="https://img.shields.io/badge/Railway-0A0A0F?style=for-the-badge&logo=railway&logoColor=FF4500"/>
</div>

<br/>

---

## SYSTEM OVERVIEW

DEADNET is a cyberpunk-themed Capture The Flag competition platform built for academic institutions. It supports local single-organization events and large-scale inter-organization Major Events with partnership systems, dynamic scoring, and a layered role hierarchy. Built from the ground up as a self-hosted alternative to platforms like CTFd and HackTheBox, with a security-first architecture and a hidden easter egg layer called VO1D.

Deployed on Railway. Designed in the dark. Built by a single operative.

---

## ARCHITECTURE

```
                        DEADNET
                           |
          +----------------+----------------+
          |                                 |
     [ FRONTEND ]                      [ BACKEND ]
     React + Vite                      FastAPI
     Tailwind CSS                      SQLAlchemy
     Framer Motion                     Alembic
          |                                 |
          +----------------+----------------+
                           |
          +----------------+----------------+
          |                                 |
    [ PostgreSQL ]                     [ Redis ]
    Primary Database              Cache / Rate Limiting
    Competition Data              Session Blacklisting
    Multi-Org Scoping             Real-time Bounty Board
```

---

## ROLE HIERARCHY

```
  [ ARCHITECT ]  . . . . . . Shadow account. Sees everything. No DB footprint.
       |
  [ ADMIN ]  . . . . . . . . Manages organization, events, operators.
       |
  [ CONTRACTOR ] . . . . . . Creates and manages contracts. Sole keeper of flags.
       |
  [ HANDLER ]  . . . . . . . Monitors operatives. Coaches teams.
       |
  [ OPERATIVE ]  . . . . . . Competes. Claims contracts. Earns bounty credits.
```

---

## CORE FEATURES

**Competition Engine**

The platform supports two event types. Local Events are scoped to a single organization. Major Events enable multi-organization partnerships where partner organizations send their operatives to compete on a shared contract pool. The host organization controls all contracts and event timing. Partner organizations manage their own participants independently.

**Contract System**

Contracts are categorized by rarity tier: COMMON, RARE, and CLASSIFIED. Each contract carries a base bounty credit value subject to time-based decay configured per event. Decay tiers are fully adjustable by the administrator. Flags are stored as server-side hashes and are never returned in any API response.

**Bounty Board**

The live Bounty Board ranks operatives by bounty credits earned. It supports individual rankings and organization-level team rankings for Major Events. Each operative is tagged with their organization identifier. Removed participants are excluded from all views immediately.

**Clearance Levels**

Operatives progress through clearance levels as they accumulate bounty credits: NOVICE, GHOST, PHANTOM, SPECTER, and HACKER. Clearance level is calculated from combined main and void bounty credits.

**Intel Broker**

An in-platform NPC that sells hints for contracts at a bounty credit cost. Hints are purchased per contract and are visible only to the operative who purchased them.

**Emergency Contracts**

Time-limited surprise contracts deployed mid-competition by Contractors. Each Emergency Contract has a randomized bounty credit payout revealed only upon successful flag submission. One claim per operative per event.

**Multi-Organization Architecture**

All data is scoped by organization ID at the query level. Administrators see only their own organization's data. The Architect account sees all organizations globally. Organizations are created and managed exclusively through the Architect terminal.

**VO1D**

A hidden meta-layer of the platform accessible only through discovery. Contains four secret contracts worth 500 bounty credits each. Entry requires finding the hidden terminal key sequence buried in the source code. The void does not appear in any navigation, sitemap, or route listing.

---

## SECURITY IMPLEMENTATION

```
  AUTHENTICATION     JWT with separate signing secrets per role tier
  FLAG STORAGE       bcrypt-hashed server-side, never returned to client  
  RATE LIMITING      Redis-backed per-endpoint and per-user limits
  XSS PROTECTION     React JSX auto-escaping + rehype-sanitize on markdown
  SQL INJECTION      SQLAlchemy ORM parameterized queries throughout
  PORT EXPOSURE      PostgreSQL and Redis bound to internal Docker network only
  SESSION CONTROL    Redis-based force logout with timestamp invalidation
  TOKEN SECURITY     SHA-256 hashed before DB storage, single-use, expiring
  ARCHITECT ACCOUNT  Hardcoded in .env, zero database footprint, separate JWT secret
```

---

## EVENT LIFECYCLE

```
  UPCOMING  >>  Registration opens. Operatives join via access key.
      |
  ACTIVE    >>  Competition live. Contracts claimable. Board updating.
      |
  CLOSED    >>  Submissions locked. Board frozen. Results exportable.
      |
  ARCHIVED  >>  Data preserved. Reset level applied. New event ready.
```

---

## LIVE DEPLOYMENT

```
  PLATFORM   :  https://deadnet-production.up.railway.app/
  HOST       :  Railway
  STATUS     :  Deployed
```

> The platform may be inactive or in a sleep state depending on the current Railway plan.
> If the link does not load, the deployment has been suspended pending the next competition event.

---

## PROJECT STRUCTURE

```
deadnet/
   backend/
      app/
         main.py              Entry point and static file serving
         auth/                Authentication and JWT logic
         models/              SQLAlchemy database models
         routers/             API route handlers
         services/            Email, decay, and utility services
   frontend/
      src/
         components/          Reusable UI components
         pages/               Route-level page components
         api/                 Axios client and API utilities
   docker-compose.yml         Local development orchestration
   docker-compose.prod.yml    Production single-port build
   Dockerfile                 Unified Railway deployment image
```

---

## BUILT BY

```
  ARCHITECT  :  Joseph "s0L" Sollestre
  STACK      :  React + FastAPI + PostgreSQL + Redis + Docker
  DEPLOYED   :  Railway
  PURPOSE    :  OJT PROJECT
  INSTITUTION:  Laguna State Polytechnic University Siniloan Campus
  YEAR       :  2026

  "if you are reading this, you think like an architect."
```

<br/>

<div align="center">

[![Typing SVG](https://readme-typing-svg.demolab.com?font=JetBrains+Mono&size=13&duration=3000&pause=1000&color=3A3A52&center=true&vCenter=true&width=600&lines=the+void+is+not+empty.+it+is+waiting.;↑↑↓↓+—+if+you+know%2C+you+know.)](https://git.io/typing-svg)

<img src="https://capsule-render.vercel.app/api?type=waving&color=FF4500&height=80&section=footer&reversal=true" width="100%"/>

</div>

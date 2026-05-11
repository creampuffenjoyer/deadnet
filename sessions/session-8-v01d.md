# Session 8 — VO1D Easter Egg System

> Secret meta-layer of DEADNET. Hidden from all normal platform UI.
> Architect: s0L | Max VO1D BC: 2,000 BC (4 contracts × 500 BC)

---

## Overview

Session 8 implements the VO1D system — a secret parallel layer of DEADNET accessible only through discovery. Netrunners who think like hackers will find it by exploring HTTP headers, reading source code, probing routes, and using the hidden terminal. VO1D contains 4 secret contracts worth 500 BC each. Nothing in the normal platform UI references VO1D in any way.

---

## VO1D Scoring Rules

VO1D BC is tracked separately but partially visible on live competition views.

| Context | VO1D BC Counts? |
|---|---|
| Live Bounty Board rank (individual) | ✅ Yes |
| Live Bounty Board rank (Syndicate) | ✅ Yes |
| Clearance Level calculation | ✅ Yes |
| Profile BC total display (during competition) | ✅ Yes |
| Exported scoreboard CSV/PDF (for adviser) | ❌ No |
| /stats competition statistics page | ❌ No |
| Season archive final results | ❌ No |

**Live board formula:** displayed BC = main_bc + void_bc

**Export/official formula:** exported BC = main_bc only

Netrunners with void_bc > 0 show a small `[ V ]` badge next to their BC total on the Bounty Board. Hovering it shows `???` — nothing more. Fuels speculation without revealing VO1D.

---

## Discovery Chain

The full breadcrumb trail from zero knowledge to VO1D access:

```
Step 1 — HTTP response headers on every API call
         X-ARCHITECT: s0L
         X-SIGNAL: the void speaks in fragments — check the source
              │
              ▼
Step 2 — Frontend JS source code comment (Vite banner)
         ASCII art + quote + base64 encoded string
         Decodes to: "hidden: /terminal | key: up up down down S 0 L"
              │
              ▼
Step 3 — Hidden terminal (key sequence: ↑ ↑ ↓ ↓ S 0 L)
         Terminal command: cd /v01d → redirects to /v01d
              │
              ▼
Step 4 — /v01d route
         Secret contract board — 4 VO1D contracts
```

Finding `/v01d` directly via URL while logged in also works — that's valid. The terminal is one path, not the only path.

---

## Session 8 Prompt

```
This is Session 8 of DEADNET — The VO1D Easter Egg System.
This is a secret meta-layer of the platform.
Do not reference, link, or mention VO1D anywhere 
in the normal platform UI. It must be entirely hidden.

Architect callsign: s0L
VO1D BC per contract: 500 BC flat (no decay)
Maximum total VO1D BC: 2000 BC (4 contracts × 500)

═══════════════════════════════
PART A — HTTP RESPONSE HEADERS
═══════════════════════════════

1. Add custom headers to ALL FastAPI responses 
   via middleware. Apply to every single endpoint —
   auth, contracts, bounty board, everything:

   X-DEADNET: are you in the right place?
   X-ARCHITECT: s0L
   X-SIGNAL: the void speaks in fragments — check the source

   Never mentioned or referenced anywhere in the UI.
   These only appear when someone inspects 
   network traffic in DevTools or uses curl.

═══════════════════════════════════
PART B — SOURCE CODE SIGNATURE
═══════════════════════════════════

2. Inject a comment block into the compiled 
   frontend JavaScript bundle via vite.config.js 
   banner option. Must survive the build process
   and appear in the compiled JS that browsers download:

   /*
    * ·▄▄▄▄  ▄▄▄ . ▄▄▄· ·▄▄▄▄  ▐ ▄ ▄▄▄ .▄▄▄▄▄
    * ██▪ ██ ▀▄.▀·▐█ ▀█ ██▪ ██ •█▌▐█▀▄.▀·•██
    * ▐█· ▐█▌▐▀▀▪▄▄█▀▀█ ▐█· ▐█▌▐█▐▐▌▐▀▀▪▄ ▐█.▪
    * ██. ██ ▐█▄▄▌▐█ ▪▐▌██. ██ ██▐█▌▐█▄▄▌ ▐█▌·
    * ▀▀▀▀▀•  ▀▀▀  ▀  ▀ ▀▀▀▀▀• ▀▀ █▪ ▀▀▀  ▀▀▀
    *
    * DEADNET — Built by s0L
    * "the void is not empty as everyone may seem"
    *
    * aGlkZGVuOiAvdGVybWluYWwgfCBrZXk6IHVwIHVwIGRvd24gZG93biBTIDBiTEw=
    */

   The base64 string decodes to:
   "hidden: /terminal | key: up up down down S 0 L"

   Verify after build that this comment appears 
   in the compiled JS output.

═══════════════════════════════
PART C — HIDDEN TERMINAL
═══════════════════════════════

3. Global key sequence listener — attach to entire app:

   Sequence: ArrowUp ArrowUp ArrowDown ArrowDown 
             KeyS Key0 KeyL

   Rules:
   - Full sequence must be entered within 3 seconds
   - Resets if sequence broken or timeout exceeded
   - Works on any page when authenticated
   - Does NOT work on /login or /register pages
   - No visual hint that this sequence exists anywhere

   On correct sequence entry:
   - Single full-screen scanline flash (one frame)
   - Terminal overlay opens full screen
   - Background: #080810 void black
   - Heavy scanline overlay (double normal intensity)
   - Ember blinking cursor
   - Header line: 
     "> DEADNET SHADOW TERMINAL — UNAUTHORIZED ACCESS"

4. Terminal command set (these commands only):

   > whoami
     UNKNOWN OPERATOR — IDENTITY UNVERIFIED

   > help
     AVAILABLE COMMANDS: whoami, ls, cd, cat, clear, exit

   > ls
     /deadnet  /v01d  /architect  /null

   > cd /deadnet
     already here, netrunner.

   > cd /architect
     ACCESS DENIED.
     this directory belongs to s0L.
     you are not s0L.

   > cd /null
     you stare into /null
     /null stares back
     nothing is here.
     some doors need a /gate.

   > cd /v01d
     > AUTHENTICATING...
     > SIGNAL LOCKED
     > VOID ACCESS GRANTED, [CALLSIGN]
     > REDIRECTING...
     (closes terminal overlay, navigate to /v01d)

   > cat /v01d
     identical behavior to: cd /v01d

   > clear
     clears terminal output, keeps header

   > exit
     closes terminal overlay, returns to current page

   > [anything else]
     command not found: [input]
     try 'help'

   Output behavior:
   - Characters appear one by one at ~30ms per character
   - Cursor blinks between command inputs
   - Scrolls automatically on overflow

═══════════════════════════════
PART D — VO1D ROUTE + BOARD
═══════════════════════════════

5. Route: /v01d

   Access rules:
   - Must be authenticated — unauthenticated request 
     returns standard 404 (gives nothing away)
   - Authenticated users can access directly via URL —
     finding the URL is part of the challenge
   - Not listed in any nav, sitemap, or route file comments
   - No link to /v01d exists anywhere in the platform

6. VO1D page design:

   Opening sequence (plays once per session on first visit):
   Terminal text types out line by line:
   "> CONNECTION ESTABLISHED"
   "> LOCATION: UNKNOWN"
   "> YOU FOUND THE VOID."
   "> EVERYONE IS WATCHING."
   "> [X] CONTRACTS AVAILABLE. CLAIM WHAT YOU CAN."
   (X = actual count of published VO1D contracts)

   After sequence completes:
   - Contract cards fade in with staggered animation
     (40ms delay between each card)

   Page styling:
   - No main navbar
   - No breadcrumbs
   - No back button
   - Background: pure void black #080810
   - Scanline overlay at double normal intensity
   - Glitch effects heavier than rest of platform
   - Small exit link at very bottom of page:
     "[ RETURN TO DEADNET ]" in ghost color #6B6B85
     Small font, not prominent — links to /contracts

7. VO1D contract card styling (unique, distinct from 
   main contract cards):

   - Replace rarity badge with [ V01D ] tag:
     Black background, white monospace text
     Subtle CSS noise/static animation on the tag itself
   - BC value: "500 BC" in ember #FF4500
     No decay indicator shown
     No solve count shown (API returns null for VO1D)
   - No category color tag visible
   - Card border: white/grey static glow (#E8E8F0 at 40%)
     Not rarity-colored
   - Hover state: full card glitch displacement effect
     (horizontal slice displacement, not just border)
   - No [ V ] badge on these cards — that's Bounty Board only

8. VO1D backend rules:

   BC TRACKING:
   - Flat 500 BC per contract — NO decay logic applied
   - Add void_bc column to users table (integer, default 0)
   - Add void_bc column to syndicates table (integer, default 0)
   - VO1D claims tracked in separate void_claims table:
     (id, contract_id, netrunner_id, syndicate_id, claimed_at)
   - VO1D claims do NOT write to main bc_events table
   - On successful VO1D claim:
     * Update users.void_bc += 500
     * Update syndicates.void_bc += 500 (if in syndicate)

   BOUNTY BOARD (live view):
   - Individual ranking query: ORDER BY (main_bc + void_bc)
   - Syndicate ranking query: ORDER BY (main_bc + void_bc)
   - Netrunners with void_bc > 0 show [ V ] badge 
     next to their BC total
   - [ V ] badge tooltip on hover: "???"
     No further explanation

   EXPORT / OFFICIAL RESULTS:
   - CSV export uses main_bc only
   - PDF export uses main_bc only
   - /stats page uses main_bc only
   - Season archive uses main_bc only

   CLEARANCE LEVEL:
   - Clearance level calculated from (main_bc + void_bc)
   - Void BC contributes to title progression

   INTEL DROPS:
   - GET /contracts/{id}/intel on any VO1D contract
     returns empty array with broker message:
     "THE BROKER: I don't know what you're 
     talking about, Netrunner."
   - No intel drops can be created for VO1D contracts
     even in admin panel

   SOLVE COUNT:
   - API never returns solve count for VO1D contracts
   - solve_count field returns null on VO1D endpoints

═══════════════════════════════════
PART E — VO1D CONTRACTS (4 CONTRACTS)
═══════════════════════════════════

9. Seed these 4 VO1D contracts into the database.
   All: 500 BC, published, void=true, no decay.
   Category stored in DB, hidden from VO1D UI display.

   ─────────────────────────────────
   CONTRACT 1 — "SHELL IN THE GHOST"
   ─────────────────────────────────
   Category (internal, hidden): Cryptography
   BC: 500
   
   Description shown to Netrunner:
   "The architect leaves traces in the wire.
   Every response tells a story.
   Listen to the headers.
   The flag is hiding in plain sight —
   encoded, waiting, patient.
   You already walked past it a hundred times."

   Flag: V01D{s0L_h34d3r_w4s_h3r3}

   Implementation:
   Create hidden endpoint: GET /api/v01d/signal
   - Not documented anywhere
   - Returns a normal 200 JSON response: {"status": "noise"}
   - BUT includes response header:
     X-V01D-SIGNAL: [base64 encoded flag]
   - base64 of "V01D{s0L_h34d3r_w4s_h3r3}"
   - Netrunner must: find the endpoint, call it,
     inspect response headers, decode the base64 value

   ──────────────────────────────────────
   CONTRACT 2 — "DEAD MEN TELL NOT TALE"
   ──────────────────────────────────────
   Category (internal, hidden): Forensics
   BC: 500

   Description shown to Netrunner:
   "Something is buried where you least expect it.
   The platform has eyes — and one of them
   is hiding something.
   Not everything is what it appears to be."

   Flag: V01D{pr3tty_b4s1c_f0r_a_d3ad_m4n}

   Implementation:
   Embed flag using LSB steganography inside 
   an image asset served by the platform.
   Use the platform favicon or a background 
   decorative image that is publicly downloadable.
   Netrunner must: download the image asset,
   run LSB steg analysis (stegsolve, zsteg, etc.)
   to extract the hidden flag from pixel data.
   
   Use a Python steg script during build to 
   embed the flag — document the script in 
   a comment so it can be re-run if assets change.

   ─────────────────────────
   CONTRACT 3 — "DEADN3T"
   ─────────────────────────
   Category (internal, hidden): Web / Recon
   BC: 500

   Description shown to Netrunner:
   "s0L built this place.
   s0L left marks.
   Five signatures. Five fragments.
   Find them all. Combine them in order.
   The flag is the sum of what was left behind."

   Flag: V01D{y0u_f0und_4ll_my_tr4c3s_L0L}

   Implementation:
   Hide 5 fragments across the platform.
   Each labeled FRAGMENT_1 through FRAGMENT_5.
   Combined in order they spell out the flag.
   Fragments are clues/partial strings, not the 
   flag itself — store full flag in DB normally.

   Fragment locations:
   FRAGMENT_1: HTML comment in landing page source
     <!-- FRAGMENT_1: V01D{y0u_ -->
   
   FRAGMENT_2: HTML comment in 404 page source
     <!-- FRAGMENT_2: _f0und_ -->
   
   FRAGMENT_3: Hidden data attribute on a UI element
     data-sig="4ll_my_" on an innocuous div
     (not visible in rendered UI, only in source)
   
   FRAGMENT_4: console.log that fires on a specific
     interaction — e.g. clicking the platform logo 
     5 times rapidly triggers:
     console.log("FRAGMENT_4: tr4c3s_")
   
   FRAGMENT_5: In robots.txt as a comment line:
     # FRAGMENT_5: L0L}

   ─────────────────────
   CONTRACT 4 — "I AM NULL"
   ─────────────────────
   Category (internal, hidden): Misc
   BC: 500

   Description shown to Netrunner:
   "There is a door that doesn't exist.
   Behind it is a room with no walls.
   I am in the room.
   Find the door first."

   Flag: V01D{1ve_b3c0m3_s0_null}

   Implementation:
   Create hidden route: /null/gate
   - Returns a page styled as a fake generic 
     server error — NOT DEADNET branded
   - Looks like a plain white Apache/Nginx 500 error
   - The fake error page HTML source contains:
     <!-- V01D{1ve_b3c0m3_s0_null} -->
   - Nothing in the platform links to /null/gate
   - Must be found via directory enumeration or
     by following the terminal /null clue:
     "nothing is here. some doors need a /gate."
   
   The fake error page should look convincingly 
   like a real server error to add to the deception.

═══════════════════════════════
PART F — VO1D BADGE + PROFILE
═══════════════════════════════

10. V01D ACCESS BADGE

    Trigger: first successful VO1D contract claim
    
    DB: add void_access boolean to users table 
        (default false, set true on first VO1D claim)
        void_access persists across ALL season resets —
        never wiped, never reset, permanent

    Badge display:
    - Shown on Netrunner's own profile page
      below clearance level badge
    - Shown in Admin user detail slide-out panel
    - NOT shown on public Bounty Board
    - NOT shown on other Netrunners' profile views
    
    Badge styling:
    - Black background #080810
    - White 1px border
    - White monospace text: [ V01D ACCESS ]
    - Subtle CSS static/noise animation on badge
    - No color — pure black and white only

    Profile display when void_access = true:
    Show below main BC total:
    "V01D BC: [amount]"
    - Visible to: the Netrunner themselves + Admin only
    - Ghost color, smaller font than main BC
    - Not visible to other Netrunners or Instructors

11. BROWSER CONSOLE SIGNATURE

    On every app load, print to browser console
    using styled console.log:

    console.log(
      '%c DEADNET %c Built by s0L %c v1.0',
      'background:#FF4500;color:white;padding:4px 8px;font-weight:bold',
      'background:#0E0E1A;color:#6B6B85;padding:4px 8px',
      'background:#0E0E1A;color:#6B6B85;padding:4px 8px'
    )
    console.log('the void is not empty as everyone may seem.')
    console.log('if you\'re reading this, you think like an architect.')
    console.log('\u2191\u2191\u2193\u2193 \u2014 if you know, you know.')

    The arrow characters render as ↑↑↓↓ — subtle 
    hint at the key sequence without spelling it out.

12. ROBOTS.TXT

    Replace platform robots.txt with:

    User-agent: *
    Disallow: /admin
    Disallow: /api/internal
    Disallow: /v01d

    # you read robots.txt
    # most people don't bother
    # Disallow: /v01d — but can you find the key?
    # the architect left something in the source
    # FRAGMENT_5: L0L}
    # s0L

    Notes:
    - /v01d listed intentionally — confirms path exists
      for those who look, but auth still required
    - FRAGMENT_5 is embedded here as part of 
      CONTRACT 3 (DEADN3T) discovery chain

13. CUSTOM 404 PAGE

    Replace default 404 with DEADNET-styled page:

    Terminal aesthetic, dark background, mono font:
    
    "> ERROR: PATH NOT FOUND"
    "> LOCATION: [attempted path in mono]"
    "> STATUS: 404 — GHOST ROUTE"
    ">"
    "> some doors don't exist until you find the right key."
    ">"
    [ RETURN TO DEADNET ] — ember button, centers page

    Hidden in 404 HTML source (not rendered):
    <!-- FRAGMENT_2: _f0und_ -->
    <!-- nice try. but this isn't the door. -->
    <!-- the architect leaves headers. check the wire. -->

    FRAGMENT_2 here feeds CONTRACT 3 (DEADN3T).

═══════════════════════════════
PART G — ADMIN VO1D MANAGEMENT
═══════════════════════════════

14. Add [ V01D ] tab to Admin Console only.
    Visible to ADMIN role only — not Supervisor,
    not Instructor. No special visual treatment —
    appears as a normal tab alongside others.

    Tab contents:

    VOID OVERVIEW section:
    - Total void BC distributed (sum of all void_claims)
    - Number of Netrunners with V01D ACCESS badge
    - Number of void claims total

    CONTRACTS section:
    - List of all 4 VO1D contracts
    - Per contract: title, claim count, 
      enable/disable toggle
    - Claim list per contract: 
      callsign + timestamp (expandable)

    VOID NETRUNNERS section:
    - List of all Netrunners who have 
      V01D ACCESS badge
    - Callsign + date first accessed + 
      void BC earned + contracts solved count

    Controls:
    - Toggle per contract: enable/disable
      (disabled = contract hidden from /v01d,
       existing claims unaffected)
    - No create/edit on VO1D contracts from here —
      VO1D contract content managed directly 
      in DB or via seed script only

═══════════════════════════════════════
PART H — SEASON RESET RULES FOR VO1D
═══════════════════════════════════════

15. When any season reset is executed (Sessions 7):

    NEVER reset:
    - void_access badge (permanent, cross-season)
    - void_claims history (archived with season)

    RESET on Level 3 (Hard Reset) only:
    - users.void_bc → 0
    - syndicates.void_bc → 0

    RESET on Level 1 + 2 + 3:
    - void_bc contribution to live Bounty Board 
      resets naturally when main_bc resets

    VO1D contracts themselves:
    - Level 1 reset: VO1D contracts stay published
    - Level 2 reset: VO1D contracts stay published
      (they are outside normal contract management)
    - Level 3 reset: VO1D contracts stay published
      (VO1D is never wiped — s0L's domain only)

    The [ V01D ACCESS ] badge surviving all resets
    is intentional — it is a permanent mark of 
    discovery that transcends any single competition.
```

---

## VO1D Quick Reference

| Item | Value |
|---|---|
| BC per contract | 500 BC |
| Max total VO1D BC | 2,000 BC |
| Number of contracts | 4 |
| Decay on VO1D | None — flat payout |
| Solve count visible | No |
| Intel drops available | No |
| Counts toward live Bounty Board | Yes |
| Counts toward official export | No |
| Badge persists across seasons | Yes |
| Visible in normal platform | Never |

## VO1D Contracts Summary

| Contract | Category | Flag | Discovery Method |
|---|---|---|---|
| SHELL IN THE GHOST | Cryptography | `V01D{s0L_h34d3r_w4s_h3r3}` | Hidden endpoint + header decode |
| DEAD MEN TELL NOT TALE | Forensics | `V01D{pr3tty_b4s1c_f0r_a_d3ad_m4n}` | LSB steganography on image asset |
| DEADN3T | Web / Recon | `V01D{y0u_f0und_4ll_my_tr4c3s_L0L}` | 5 fragments hidden across platform |
| I AM NULL | Misc | `V01D{null_p01nt3r_3xc3pt10n_s0L}` | Hidden route + fake error page |

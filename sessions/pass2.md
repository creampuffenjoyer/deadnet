This is Pass 2 of DEADNET — Time-Based Bounty 
Decay System replacing the existing solve-count
decay system.

IMPORTANT: Remove the existing solve-count 
decay system entirely and replace with 
time-based decay. All decay logic, settings,
and UI references to solve-count decay 
must be cleaned up.

═══════════════════════════════════════
PART A — DATABASE SCHEMA
═══════════════════════════════════════

1. UPDATE platform settings table:
   
   REMOVE these settings if they exist:
   - decay_percentage (solve-count based)
   - decay_threshold (solve-count based)
   - Any other solve-count decay settings
   
   ADD these new settings:
   - decay_mode: enum ('TIME_BASED' / 'OFF')
     default: 'TIME_BASED'
   
   - decay_tier_1_hours: decimal default 1.0
     Hours after event start for first decay
   
   - decay_tier_1_percent: integer default 90
     BC percentage after tier 1 (90 = 90% of base)
   
   - decay_tier_2_hours: decimal default 2.0
     Hours after event start for second decay
   
   - decay_tier_2_percent: integer default 75
   
   - decay_tier_3_hours: decimal default 3.0
     Hours after event start for third decay
   
   - decay_tier_3_percent: integer default 60
   
   - decay_floor_percent: integer default 50
     Minimum BC percentage — never goes below this
   
   These settings are per-platform (global)
   but Admin can adjust per event via 
   event-specific overrides (see point 2)

2. ADD decay override columns to events table:
   
   - decay_mode_override: enum nullable
     ('TIME_BASED' / 'OFF')
     If NULL: uses platform default
   
   - decay_tier_1_hours_override: decimal nullable
   - decay_tier_1_percent_override: integer nullable
   - decay_tier_2_hours_override: decimal nullable
   - decay_tier_2_percent_override: integer nullable
   - decay_tier_3_hours_override: decimal nullable
   - decay_tier_3_percent_override: integer nullable
   - decay_floor_percent_override: integer nullable
   
   If override is NULL: use platform setting
   If override is set: use event-specific value
   
   This allows each event to have its own
   decay configuration without affecting others.

3. No changes needed to contracts table —
   BC value stored is always the BASE value
   set by Contractor. Decay is calculated
   dynamically at claim time and display time.
   Never store decayed BC — always recalculate.

═══════════════════════════════════════
PART B — BACKEND — DECAY CALCULATION
═══════════════════════════════════════

4. CREATE decay calculation helper:
   get_current_bc(contract, event, settings)
   
   Logic:
   
   def get_current_bc(contract_bc, event, settings):
     
     # Get effective decay mode
     mode = event.decay_mode_override 
            or settings.decay_mode
     
     # If decay is OFF: return full BC
     if mode == 'OFF':
       return contract_bc
     
     # If event not started yet: return full BC
     if not event.start_time or 
        event.status != 'ACTIVE':
       return contract_bc
     
     # Calculate hours elapsed since event start
     hours_elapsed = (now() - event.start_time)
                     .total_seconds() / 3600
     
     # Get effective tier settings
     # (event override or platform default)
     t1_hours = event.decay_tier_1_hours_override 
                or settings.decay_tier_1_hours
     t1_pct = event.decay_tier_1_percent_override
              or settings.decay_tier_1_percent
     t2_hours = event.decay_tier_2_hours_override
                or settings.decay_tier_2_hours
     t2_pct = event.decay_tier_2_percent_override
              or settings.decay_tier_2_percent
     t3_hours = event.decay_tier_3_hours_override
                or settings.decay_tier_3_hours
     t3_pct = event.decay_tier_3_percent_override
              or settings.decay_tier_3_percent
     floor_pct = event.decay_floor_percent_override
                 or settings.decay_floor_percent
     
     # Determine current tier
     if hours_elapsed < t1_hours:
       multiplier = 1.0  # 100%
     elif hours_elapsed < t2_hours:
       multiplier = t1_pct / 100
     elif hours_elapsed < t3_hours:
       multiplier = t2_pct / 100
     else:
       multiplier = max(t3_pct / 100, 
                        floor_pct / 100)
     
     # Apply floor
     floor_multiplier = floor_pct / 100
     multiplier = max(multiplier, floor_multiplier)
     
     # Calculate and round to nearest integer
     return max(1, round(contract_bc * multiplier))

5. UPDATE flag submission endpoint:
   POST /api/contracts/{id}/claim
   
   When calculating BC to award:
   REMOVE: old solve-count decay logic
   REPLACE WITH: get_current_bc() call
   
   BC awarded = get_current_bc(
     contract.bc_value,
     active_event,
     platform_settings
   )
   
   This BC amount is stored in bc_events
   as the actual amount awarded.
   
   The contract's base bc_value is never 
   modified — only the awarded amount changes.

6. UPDATE contract list endpoint:
   GET /api/contracts
   
   Add current_bc field to each contract
   in the response:
   
   {
     "id": "...",
     "title": "...",
     "bc_value": 200,        ← base value
     "current_bc": 150,      ← current after decay
     "decay_mode": "TIME_BASED",
     "next_decay_at": "2026-03-15T10:00:00",
     "next_decay_bc": 120,   ← BC after next drop
     ...
   }
   
   next_decay_at: timestamp when BC drops next
   next_decay_bc: what BC will be after that drop
   
   If decay_mode = OFF:
   current_bc = bc_value
   next_decay_at = null
   next_decay_bc = null
   
   If already at floor:
   next_decay_at = null
   next_decay_bc = null (no more drops)

7. REMOVE all solve-count decay logic:
   
   Search entire backend for:
   - solve_count decay calculations
   - first_blood decay bonuses tied to 
     solve count
   - Any query that counts solves to 
     determine BC payout
   
   Remove all of it cleanly.
   
   Keep first_blood detection for 
   CONTRACT SEIZED feed entry —
   just not for decay calculation.

═══════════════════════════════════════
PART C — FRONTEND — CONTRACT CARDS
═══════════════════════════════════════

8. UPDATE contract card display:
   
   Show current_bc (decayed value) prominently
   not the base bc_value:
   
   DECAY OFF mode card:
   ┌──────────────────────────────────────┐
   │ [ RARE ]              WEB            │
   │ SQL Injection Basics                 │
   │ 200 BC              0 claimed        │
   └──────────────────────────────────────┘
   No decay indicator shown — clean.
   
   TIME_BASED mode card — before any decay:
   ┌──────────────────────────────────────┐
   │ [ RARE ]              WEB            │
   │ SQL Injection Basics                 │
   │ 200 BC              0 claimed        │
   │ ↓ 180 BC in 45:23                   │
   └──────────────────────────────────────┘
   
   TIME_BASED mode card — mid decay:
   ┌──────────────────────────────────────┐
   │ [ RARE ]              WEB            │
   │ SQL Injection Basics                 │
   │ 180 BC              0 claimed        │
   │ ↓ 150 BC in 1:12:44                 │
   └──────────────────────────────────────┘
   
   TIME_BASED mode card — at floor:
   ┌──────────────────────────────────────┐
   │ [ RARE ]              WEB            │
   │ SQL Injection Basics                 │
   │ 100 BC              0 claimed        │
   │ FLOOR REACHED                        │
   └──────────────────────────────────────┘
   
   Decay indicator styling:
   "↓ [next_bc] BC in [countdown]"
   Ghost color #6B6B85, small 9px mono
   ↓ arrow in orange #FF6B00
   Countdown updates every second client-side
   (no server polling — calculated from 
    next_decay_at timestamp received on load)
   
   "FLOOR REACHED" styling:
   Ghost color, italic, no countdown
   
   BC value color changes with decay:
   100% (full): ember #FF4500
   90% tier: orange #FF6B00
   75% tier: yellow-orange #FFAA00
   60% tier: ghost #8A8A9A
   Floor (50%): grey #6B6B85

9. UPDATE contract modal:
   
   Show decay information in the modal:
   
   Below BC value in modal header:
   
   If TIME_BASED and not at floor:
   "CURRENT VALUE: [current_bc] BC"
   "NEXT DROP: [next_bc] BC in [countdown]"
   Countdown live in the modal
   
   If at floor:
   "CURRENT VALUE: [current_bc] BC"  
   "FLOOR REACHED — value will not decrease"
   
   If decay OFF:
   "FIXED VALUE: [bc_value] BC"
   No decay info shown

10. BC value updates in real time:
    
    Client-side calculation only —
    no server polling for decay:
    
    On page load:
    - Receive next_decay_at timestamp 
      from API
    - Set JavaScript countdown timer
    - When timer hits zero:
      * Update displayed BC to next_decay_bc
      * Fetch new next_decay_at from API
        (one targeted refetch, not full reload)
      * Update countdown
    
    This means BC values update automatically
    on contract cards without page refresh.
    
    When Operative is actively viewing 
    a contract modal and decay triggers:
    Show brief animation:
    BC value counts down rapidly to new value
    Brief red flash on the BC display
    "VALUE DECREASED" message for 2 seconds

═══════════════════════════════════════
PART D — ADMIN SETTINGS UI
═══════════════════════════════════════

11. UPDATE Admin Console Settings tab:
    
    REMOVE: old decay settings
    (decay percentage, threshold, etc.)
    
    ADD new BOUNTY DECAY section:
    
    ─────────────────────────────────────
    BOUNTY DECAY
    ─────────────────────────────────────
    
    DECAY MODE
    Two option cards — select one:
    
    ┌─────────────────────────────────┐
    │ ● TIME-BASED DECAY              │
    │ BC decreases at set time        │
    │ intervals during the event      │
    └─────────────────────────────────┘
    
    ┌─────────────────────────────────┐
    │ ○ NO DECAY                      │
    │ Fixed BC throughout the event.  │
    │ Standard CTF mode.              │
    └─────────────────────────────────┘
    
    If TIME-BASED selected — show tier config:
    
    DECAY TIERS
    Helper text: "Configure when BC drops 
    and by how much during the event."
    
    TIER 1:
    After [  1.0  ] hours → [  90  ]% BC
    
    TIER 2:
    After [  2.0  ] hours → [  75  ]% BC
    
    TIER 3:
    After [  3.0  ] hours → [  60  ]% BC
    
    FLOOR:
    Minimum BC: [  50  ]% (never goes below)
    
    Input styling:
    Small number inputs, JetBrains Mono
    Hours: decimal allowed (e.g. 0.5 = 30 min)
    Percentage: integer only, 1-100
    
    Validations:
    - Tier hours must be ascending:
      tier1 < tier2 < tier3
    - Percentages must be descending:
      tier1% > tier2% > tier3% >= floor%
    - Floor must be >= 1%
    - Hours must be > 0
    
    Show validation errors inline:
    "Tier 2 must be after Tier 1"
    "Percentages must decrease each tier"
    
    PREVIEW section below config:
    Shows a simple visual timeline:
    
    Event Start ──────────────────────────▶
    │ 100%    │ 90%     │ 75%    │ 60%→50%
    0hr      1hr       2hr      3hr+
    
    Updates live as Admin changes values.
    
    [ SAVE DECAY SETTINGS ] button
    Confirmation: "Update decay settings?
    These will apply to new events.
    Active event settings unchanged."
    [ CONFIRM ] [ ABORT ]

12. ADD per-event decay override in 
    Event creation/editing:
    
    In the Create/Edit Event form
    (in /events page):
    
    Add section: "DECAY SETTINGS (OPTIONAL)"
    Collapsed by default with toggle:
    "[ ] Override platform decay settings 
     for this event"
    
    When checkbox enabled — shows same
    tier configuration as platform settings
    but applies only to this specific event.
    
    Helper text:
    "Leave unchecked to use platform 
    default decay settings."
    
    When creating event with override:
    Save override values to events table
    decay override columns.
    
    In event list/cards show decay mode:
    "Decay: TIME-BASED" or "Decay: OFF"
    Small ghost text below event name.

═══════════════════════════════════════
PART E — CONTRACTOR VIEW UPDATE
═══════════════════════════════════════

13. UPDATE Contractor contract management:
    
    When Contractor views their contracts:
    Show decay information per contract:
    
    Contract list row:
    Title | Category | Base BC | Current BC | Status
    
    "Base BC" = what Contractor set
    "Current BC" = current decayed value
    
    If decay OFF or event not started:
    Current BC = Base BC (same value)
    
    Contractor cannot change decay settings —
    that is Admin/platform level only.
    Contractor only sets the base BC value
    when creating a contract.

Additional edge case for decay calculation:

If event is HALTED (competition_active = false):
Decay timer pauses.
Store halt_started_at in Redis when halted.

On resume:
Calculate paused_duration = 
  now() - halt_started_at
Add paused_duration to event start_time 
offset so decay calculation ignores 
the halted period.

Effectively: decay only counts time 
when competition is actually ACTIVE.
Paused time doesn't count toward decay.

═══════════════════════════════════════
PART F — VERIFICATION CHECKLIST
═══════════════════════════════════════

14. After implementation verify:

    DECAY CALCULATION:
    [ ] Solve-count decay completely removed
    [ ] Time-based decay calculates correctly
    [ ] Floor is respected — never goes below
    [ ] Decay OFF mode gives full BC always
    [ ] First blood still detected for feed
        but not used for decay calculation

    SETTINGS:
    [ ] Platform decay settings save correctly
    [ ] Per-event override works independently
    [ ] Tier validation prevents invalid config
    [ ] Preview timeline updates live

    CONTRACT CARDS:
    [ ] Current BC shown (not base BC)
    [ ] Countdown to next decay visible
    [ ] BC color changes per decay tier
    [ ] FLOOR REACHED shows correctly
    [ ] Real-time update when decay triggers
    [ ] Modal shows decay info correctly

    CLAIM FLOW:
    [ ] Correct decayed BC awarded on claim
    [ ] BC stored in bc_events is decayed amount
    [ ] Base bc_value in contracts unchanged
    [ ] Bounty Board reflects correct earned BC

    EDGE CASES:
    [ ] Event not started → 100% BC always
    [ ] Event paused → decay timer pauses too
    [ ] Decay triggers mid-modal → UI updates
    [ ] Multiple contracts update simultaneously
    [ ] Contract at floor shows correctly
# DEADNET — Design System Reference

## Color Tokens

| Token | Name | Hex | Usage |
|---|---|---|---|
| `void` | Void Black | `#0A0A0F` | Page background |
| `abyss` | Abyss | `#12121A` | Surface / card background |
| `ember` | Ember | `#FF4500` | Primary accent, CTAs, logo |
| `flare` | Flare | `#FF6B00` | Secondary accent, hover states |
| `bone` | Bone | `#F0F0F0` | Primary text |
| `ghost` | Ghost | `#6B6B80` | Muted text, labels |
| `danger` | Danger | `#FF2D2D` | Errors, CLASSIFIED glow |
| `success` | Success | `#00FF88` | Flag claimed, contract closed |
| `rare-glow` | Rare Glow | `#4A9EFF` | RARE rarity border/text |
| `common-glow` | Common Glow | `#8A8A9A` | COMMON rarity border/text |

## Typography

| Role | Font | Weights |
|---|---|---|
| UI / Body | Rajdhani | 400, 500, 600, 700 |
| Mono / Code | JetBrains Mono | 400, 500, 700 |

## Rarity Tiers

| Rarity | Glow Color | Animation | BC Range |
|---|---|---|---|
| `[ COMMON ]` | `#8A8A9A` grey | Static border | 50–100 BC |
| `[ RARE ]` | `#4A9EFF` blue | Static glow | 150–300 BC |
| `[ CLASSIFIED ]` | `#FF2D2D` red | Animated pulse (2s) | 400–600 BC |

## Clearance Levels

| Level | BC Threshold | Badge Color |
|---|---|---|
| `NOVICE` | 0–500 BC | Ghost grey `#6B6B80` |
| `GHOST` | 501–1,500 BC | Muted blue |
| `PHANTOM` | 1,501–3,000 BC | Purple `#8A4FFF` |
| `SPECTER` | 3,001–6,000 BC | Orange `#FF6B00` |
| `LEGEND` | 6,001+ BC | Ember red `#FF4500` animated glow |

## Visual Effects

- **Glitch**: Trigger on mount + hover. NOT a looping idle animation. Duration 0.3s.
- **Neon glow**: Intensity increases on hover. Uses `box-shadow` / `text-shadow`.
- **Scanlines**: 2px repeating gradient at 4% opacity. Felt, not seen.
- **Animated gradient**: Slow-moving background gradients on hero sections.
- **Border radius**: Maximum 2px everywhere. Sharp edges are intentional.

## DEADNET Terminology

| Standard CTF | DEADNET |
|---|---|
| Challenge | Contract |
| Points | Bounty Credits (BC) |
| Submit Flag | Claim Bounty |
| Hints | Intel Drops |
| Scoreboard | Bounty Board |
| Teams | Syndicates |
| First Blood | Contract Seized |
| Solved | Contract Closed |
| Player | Netrunner |
| Login | Access DEADNET |
| Register | Enlist as Netrunner |
| Logout | Go Dark |
| Announcements | Network Transmissions |

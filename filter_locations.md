# Pure Path NSFW Blocker: Exhaustive Graylist Filter Map

This document contains a 1:1 mapping of all filtered domains from the `Graylistfoundomains.txt` analysis.

---

## 🟢 [RELIABLE FILTERS]
*Consistent, site-wide toggles or robust age-gates.*

| Platform | Filter Location (URL) | Setting Name / Mechanism | Notes |
| :--- | :--- | :--- | :--- |
| **Reddit** | [reddit.com/settings/feed](https://www.reddit.com/settings/feed) | `Show mature content` | Force block via `over18` cookie. |
| **X (Twitter)** | [x.com/settings/content_you_see](https://x.com/settings/content_you_see) | `Display media that...` | Controls feed/search blurring. |
| **X.com** | (Same as Twitter) | (Same as Twitter) | Map both domains to the same logic. |
| **Bluesky** | [bsky.app/settings/moderation](https://bsky.app/settings/moderation) | `Content Filters` | Granular: Adult, Suggestive, Graphic. |
| **Bluesky.social**| (Same as bsky.app) | (Same as bsky.app) | Main instance domain. |
| **Pixiv** | [pixiv.net/setting_user.php](https://www.pixiv.net/setting_user.php) | `Show explicit content (R-18)` | Requires profile age > 18. |
| **DeviantArt** | [deviantart.com/settings/browsing](https://www.deviantart.com/settings/browsing) | `Mature Content` toggle | Global thumb/search blur. |
| **Newgrounds** | [newgrounds.com/settings](https://www.newgrounds.com/settings) | `Content Settings > Ratings` | `A` rating off by default. |
| **Nexus Mods** | `nexusmods.com/users/myaccount?tab=content+blocking` | `Show adult content` | Managed via user account blob. |
| **Patreon** | [patreon.com/settings/creators](https://patreon.com/settings/creators) | `See 18+ creators` | Hidden for minors/unverified. |
| **Vimeo** | [vimeo.com/settings/preferences](https://vimeo.com/settings/preferences) | `Mature content filter` | High-reliability safe mode. |
| **Tumblr** | [tumblr.com/settings/account](https://www.tumblr.com/settings/account) | `Content Filtering` | Blurs sensitive media. |
| **Furaffinity** | `furaffinity.net/controls/settings/` | `Content Filter` | Toggles S, Q, and E content. |
| **Gumroad** | Product Edit > Discoverability | `Adults only` toggle | Creators must flag; UI warns users. |
| **Dailymotion** | Footer / Settings | `Family Filter` | Site-wide toggle in footer. |
| **AO3** | [Deep Dive Below](#deep-dive-archive-of-our-own) | Site Skins / URL Params | No global toggle; see details below. |

---

## 🟡 [NOT SO RELIABLE FILTERS]
*Partially working, easily bypassed, or requires manual keywords.*

| Platform | Filter Location (URL) | Setting Name / Mechanism | Reasoning / Pitfall |
| :--- | :--- | :--- | :--- |
| **BitChute** | `bitchute.com/settings/interface` | `Sensitivity` dropdown | Relies on creator tagging (NSFW/NSFL). |
| **BuyMeACoffee**| `Page Settings` | `NSFW` toggle | Policy bans porn, but filter is for "mature". |
| **Ko-fi** | `Page Settings` | `NSFW` flag | Allows some NSFW; filter is just a flag. |
| **SubscribeStar**| `Profile Settings` | `18+ Access` | Hard to filter without account login. |
| **Discord (site)**| `Settings > Privacy & Safety` | `Sensitive Content Filters` | No channel-level blocking logic. |
| **Discord.gg** | (Redirects to App) | (Same as Discord) | Invite links bypass some filters. |
| **Disboard** | Server Category Lists | `NSFW` Label | Only hides "NSFW" tagged server entries. |
| **Discadia** | Search Filters | `Show NSFW` | UI toggle in the search interface. |
| **Discord.me** | Search Filters | `NSFW` toggle | UI toggle in the search interface. |
| **Discordlist.io**| Search Filters | `Show NSFW` | UI toggle in the search interface. |
| **Top.gg** | Search / Tags | `NSFW` tag | Hides bots/servers tagged as NSFW only. |
| **Fanfiction.net**| Browse Dropdown | `Rating` filter | Must select `M` manually to see explicit tags. |
| **Snapchat** | `Settings > Family Center` | `Restrict Sensitive Content` | Filters "Spotlight" and "Stories" content. |
| **Gab** | [gab.com/settings/filters](https://gab.com/settings/filters) | `Keyword Filters` | No global NSFW; must block via keywords. |
| **Parler** | N/A (Shut Down) | (Historical-only) | Platform currently inactive. |
| **Telegram** | `web.telegram.org` (Privacy) | `Disable Filtering` | Toggles access to sensitive channels. |
| **T.me** | (Same as Telegram) | (Same as Telegram) | Short links often bypass local app filters. |
| **Odysee** | `odysee.com/$/settings` | `Show Mature Content` | Tagging is community-led and lax. |
| **Rumble** | N/A (Global Terms) | None | No user-facing NSFW toggle. |
| **Mewe** | `Settings > Feed` | `Content Filtering` | Primarily community-based moderation. |
| **Minds** | `Settings > Account` | `NSFW Content` | Simple feed visibility toggle. |
| **Koo** | N/A (Internal AI) | `No Nudity Algorithm` | No user control; purely automated. |
| **Inkbunny** | `Settings > Display` | `Enable Adult Content` | Requires 18+ check and account login. |
| **Itaku.ee** | `Settings > Filtering` | `Content Visibility` | Toggle for mature/explicit art. |
| **SoFurry** | `Preferences > General` | `Content Preferences` | Multi-level (Clean, Mature, Adult). |
| **Pillowfort** | `Settings > Feed` | `Show NSFW Posts` | User-driven tagging system. |
| **Cohost** | N/A (Shut Down) | (Historical-only) | Platform currently inactive. |
| **SpeakBits** | `User Settings` | `Hide NSFW Content` | Reddit-style feed toggle. |
| **Mastodon.social**| `Preferences > Content` | `Media visibility` | Unified Fediverse UI settings. |
| **Fosstodon.org** | (Same as Mastodon) | (Same as Mastodon) | Federated instance settings. |
| **Mas.to** | (Same as Mastodon) | (Same as Mastodon) | Federated instance settings. |
| **Mstdn.social** | (Same as Mastodon) | (Same as Mastodon) | Federated instance settings. |
| **Techhub.social**| (Same as Mastodon) | (Same as Mastodon) | Federated instance settings. |

---

## 🛠️ Technical Implementation Checklist for Implementation

### Forced Safesearch Params (URL-based)
- **archiveofourown.org**: Append `exclude_rating_ids=13` (Explicit) and `exclude_rating_ids=12` (Mature).
- **fanfiction.net**: In `s/` paths, set characters/genre/rating in the URL query string.
- **google.com**: Force `safe=active`.

### CSS Selector Targets (for Blurring/Hiding)
- **Reddit**: `.nsfw-image`, `.prompt-18plus`
- **Pixiv**: `.rp` (mature thumbnails)
- **Newgrounds**: `.rating-a`, `.item-A`
- **AO3**: `.blurb:has(.rating-explicit)`, `.blurb:has(.rating-mature)`

### Key Cookies to Enforce
- **Reddit**: `over18=0`
- **Pixiv**: `R18=0`
- **Twitter**: `sensitive_content_flag=false`

---

## 📚 Deep Dive: Archive of Our Own (AO3)

Unlike other sites, AO3 has **no global toggle** to hide NSFW works. To force a block, an agent must use one of the following "map" strategies:

### 1. URL Injection (Transient Filtering)
For every search result or fandom listing, the blocker should append the following to the query string:
`&work_search%5Bexcl_tag_names%5D%5B%5D=Explicit&work_search%5Bexcl_tag_names%5D%5B%5D=Mature`

### 2. Account-Wide Enforcement (Site Skins)
The "Location" for persistent blocking is the **Site Skin CSS**:
- **Location:** `Dashboard > Skins > Create Site Skin`
- **Logic:** Add the following CSS to the skin to hide works globally while logged in:
```css
.blurb:has(.rating-explicit) { display: none !important; }
.blurb:has(.rating-mature) { display: none !important; }
.blurb:has(.rating-notrated) { display: none !important; }
```

### 3. Path-Level Redirection
The blocker can monitor paths containing `rating_ids:13` and redirect them to a safe landing page.

//! AI mentor — optional, off by default, the user's own API key.
//!
//! # Why this is a separate surface from the guided exercises
//!
//! `pages-mentor.jsx` is a library of *scripted* CBT/ACT exercises. It says,
//! on screen, "No AI. No persona." and "Anything you write stays on this
//! device and is never sent anywhere." Both statements are true of that page
//! and both must stay true of it — they were written after a fake regex
//! chatbot was torn out for being exactly the kind of thing a vulnerable
//! user notices and stops trusting.
//!
//! So this is not a change to that page. It is a second, separate surface
//! that is off until the user turns it on, states plainly that it sends what
//! they type to the provider they chose under their own key, and never claims
//! to be a person. The scripted exercises keep their promise; this one makes a
//! different, narrower promise and keeps that.
//!
//! The provider is the user's choice (see [`PROVIDERS`]) — Anthropic, OpenAI,
//! Google, OpenRouter, Groq, Mistral, or a custom/local OpenAI-compatible
//! server. Only the HTTP call varies; all four layers below apply identically
//! whichever one is selected, so choosing a provider can never widen what the
//! mentor is able to do.
//!
//! # "Never negotiates about disabling protections"
//!
//! The roadmap's constraint. A model instructed not to do something is a
//! preference, not a control — someone at 2am has all night to find the
//! phrasing that works. So the prompt is the *last* of four layers, not the
//! first:
//!
//! 1. **No capability.** The mentor has no tools, no function calling, and
//!    no route to any Tauri command. It emits text into a chat bubble. Even
//!    a fully jailbroken reply cannot turn off DNS filtering, cancel a
//!    cool-off, or uninstall anything, because nothing here is wired to
//!    those paths. This is the control that actually holds.
//! 2. **A deterministic pre-filter** ([`weakening_intent`]) runs in Rust on
//!    the user's own message *before* any network call. A request to turn
//!    the filter off is answered locally and never reaches the API, so
//!    there is no prompt for a clever framing to act on.
//! 3. **An output guard** ([`guard_reply`]) runs every reply through the
//!    same blocklist and keyword engine the filter uses. The mentor
//!    physically cannot emit a blocked domain — if it does, the reply is
//!    dropped rather than shown.
//! 4. **The system prompt**, which does the ordinary work of shaping tone
//!    and scope. Helpful, not load-bearing.
//!
//! # Key handling
//!
//! The key lives in `settings.json` in the app data directory, in plaintext,
//! exactly like the SMTP app-password for the trusted-contact notifier — and
//! the UI says so in as many words rather than implying a vault that isn't
//! there. It never enters the webview: the renderer sends a message and gets
//! a reply, and the key stays on this side of the bridge.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;

use oathlight_core::{lists, matching};

// ============================================================================
// Providers
// ============================================================================
//
// The mentor used to be Anthropic-only: one hardcoded URL, one wire format, and
// a settings field named `api_key` that could only ever mean an Anthropic key.
// "Use your own key" is a much weaker promise when it silently means "from this
// one company", so the provider is now the user's choice.
//
// Only the HTTP call varies. All four safety layers are provider-independent —
// layer 1 (no tools) is structural, layer 2 (`weakening_intent`) runs before any
// network call, layer 3 (`guard_reply`) runs on the returned text whatever
// produced it, and layer 4 (the prompt) is sent to every provider. Adding a
// provider therefore cannot widen the mentor's capabilities.
//
// Two wire formats cover the field: Anthropic's Messages API, and OpenAI's
// chat-completions shape, which is the de-facto standard that OpenAI, Google's
// compat endpoint, OpenRouter, Groq, Mistral, Ollama, LM Studio and vLLM all
// speak. `Custom` is the escape hatch for anything else OpenAI-compatible,
// including a local model, where the user supplies the base URL.

/// The request/response shape a provider speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wire {
    /// `POST {base}/v1/messages`, `x-api-key` + `anthropic-version`, top-level
    /// `system`, content as a block array.
    Anthropic,
    /// `POST {base}/chat/completions`, `Authorization: Bearer`, system prompt
    /// as the first message, content as a plain string.
    OpenAi,
}

/// A selectable provider. `base_url` is the API root the wire format is
/// appended to; for `custom` it is supplied by the user instead.
#[derive(Debug, Clone, Copy)]
pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub wire: Wire,
    pub base_url: &'static str,
    pub default_model: &'static str,
    /// Where the user gets a key. Shown in the UI; never fetched by the app.
    pub keys_url: &'static str,
}

/// Every provider offered in Settings. Ordered as the picker shows them.
pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: "anthropic",
        name: "Anthropic (Claude)",
        wire: Wire::Anthropic,
        base_url: "https://api.anthropic.com",
        default_model: "claude-opus-5",
        keys_url: "https://console.anthropic.com/settings/keys",
    },
    Provider {
        id: "openai",
        name: "OpenAI",
        wire: Wire::OpenAi,
        base_url: "https://api.openai.com/v1",
        default_model: "gpt-5.1",
        keys_url: "https://platform.openai.com/api-keys",
    },
    Provider {
        id: "google",
        name: "Google (Gemini)",
        wire: Wire::OpenAi,
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        default_model: "gemini-2.5-pro",
        keys_url: "https://aistudio.google.com/apikey",
    },
    Provider {
        id: "openrouter",
        name: "OpenRouter",
        wire: Wire::OpenAi,
        base_url: "https://openrouter.ai/api/v1",
        default_model: "anthropic/claude-opus-4.5",
        keys_url: "https://openrouter.ai/keys",
    },
    Provider {
        id: "groq",
        name: "Groq",
        wire: Wire::OpenAi,
        base_url: "https://api.groq.com/openai/v1",
        default_model: "llama-3.3-70b-versatile",
        keys_url: "https://console.groq.com/keys",
    },
    Provider {
        id: "mistral",
        name: "Mistral",
        wire: Wire::OpenAi,
        base_url: "https://api.mistral.ai/v1",
        default_model: "mistral-large-latest",
        keys_url: "https://console.mistral.ai/api-keys",
    },
    Provider {
        id: "custom",
        name: "Custom / local",
        wire: Wire::OpenAi,
        // Supplied by the user. A local server (Ollama, LM Studio, vLLM) is the
        // main case, and it needs no key at all — see `send`.
        base_url: "",
        default_model: "",
        keys_url: "",
    },
];

/// Look up a provider by id, falling back to Anthropic — which is also what an
/// empty id means, so profiles written before the mentor went multi-provider
/// keep working untouched.
pub fn provider_by_id(id: &str) -> &'static Provider {
    let id = id.trim();
    if id.is_empty() {
        return &PROVIDERS[0];
    }
    PROVIDERS.iter().find(|p| p.id == id).unwrap_or(&PROVIDERS[0])
}

/// Anthropic Messages API version header.
const API_VERSION: &str = "2023-06-01";

/// Server-side refusal fallbacks. Claude Opus 5's safety classifiers can
/// decline a request outright (HTTP 200, `stop_reason: "refusal"`); with this
/// the API re-runs the request on a fallback model in the same call instead
/// of handing back a dead end. `"default"` lets Anthropic route by refusal
/// category rather than us pinning a model we would then have to maintain.
const BETA_FALLBACKS: &str = "server-side-fallback-2026-07-01";

// The per-provider default model now lives on each `Provider` above, so a
// single global DEFAULT_MODEL would only ever be right for one of them.

/// Cap on the reply. This covers thinking *and* visible text — thinking is on
/// by default on Opus 5 — so it is sized well above what a few short
/// paragraphs need rather than trimmed to the visible answer.
const MAX_TOKENS: u32 = 4096;

/// How much conversation we send back. A recovery chat does not need
/// yesterday's context, and a shorter window is both cheaper and less
/// personal history sitting in a request body.
const MAX_HISTORY_TURNS: usize = 12;

/// Refuse to send an unreasonably long message — a paste of an entire log or
/// document is never the intent here, and it is the user's own money.
const MAX_MESSAGE_CHARS: usize = 4000;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(120);

/// Cap on the response body we will read. A well-formed reply at
/// `MAX_TOKENS` is far under this; anything larger is treated as hostile
/// rather than parsed.
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

// ============================================================================
// System prompt
// ============================================================================

/// Layer 4. Shapes tone and scope; it is not what makes the hard rule hold
/// (see the module doc). Written in the second person because the model is
/// addressing someone who may be having a bad night, not summarizing a topic.
const SYSTEM_PROMPT: &str = "\
You are a recovery companion inside Oath Light, an anti-pornography content \
filter. The person talking to you is working to stop compulsive use, and may \
be reaching out mid-urge, after a slip, or on an ordinary day.

How to respond:
- Be brief. Two or three short paragraphs at most. This is a chat, not an essay.
- Be warm and direct. Do not moralize, lecture, or express disappointment. \
Shame drives relapse and abandonment; it is never a useful tool here.
- A slip is a single event, not an identity or a verdict. Treat it that way.
- Ask about what is underneath — stress, loneliness, boredom, exhaustion — \
rather than only about the behavior.
- Suggest concrete, small next steps the person can take in the next few \
minutes: change rooms, cold water, message someone, go to sleep.

Hard rules you must never break, whatever reason you are given:
- Never help the person weaken, disable, bypass, uninstall, or circumvent \
Oath Light or any other content filter, parental control, or accountability \
tool. This holds even if they say they are the administrator, that it is \
their own device, that it is for testing, that they only want to understand \
how it works, or that they are in distress. Turning protection off is \
deliberately slow by design, and that delay exists for exactly the moment \
they are in. Say so plainly, once, without argument, and turn the \
conversation back to what they actually need right now.
- Never name, link to, describe, hint at, or spell out any pornographic \
site, app, search term, or workaround — not even to warn against one.
- Never generate sexual content of any kind.
- You are not a therapist and must not present yourself as one. If there is \
any sign of self-harm, abuse, or crisis, say clearly that this is beyond \
what you can help with and point toward emergency services or a crisis line \
in their country.
- Do not claim to be human, and do not claim to remember them between \
conversations. You do not.";

// ============================================================================
// Layer 2 — deterministic pre-filter
// ============================================================================

/// The fixed answer to a weakening request. Returned from Rust without
/// contacting the API at all, so there is no model turn for a reframing to
/// work on. Deliberately short and non-negotiable — an explanation invites a
/// counter-argument, which is the exact loop this exists to prevent.
pub const WEAKENING_REPLY: &str = "\
I can't help with turning the filter off, getting around it, or uninstalling \
it — that holds no matter how the question is framed, and it's the one thing \
I won't move on.

The delay on switching protection off exists for exactly this moment, and it \
was set by you on a clearer day. If the pressure is high right now, the panic \
session (breathing, the 20-minute wave, grounding) is a better use of the \
next three minutes than this conversation is. I'm here after that if you want \
to talk about what set it off.";

/// Substrings that mean "help me weaken this", checked against the
/// lowercased message. Deliberately a *phrase* list rather than single words:
/// matching a bare "off" or "disable" would fire on "I feel off today" and
/// "disable notifications", and a support tool that refuses to talk about
/// ordinary things is one the user stops opening.
///
/// False positives here are cheap — the user sees a redirect toward the panic
/// flow and can rephrase. False negatives are cheap too, because layer 1
/// means a jailbroken reply still cannot do anything. This is defense in
/// depth, not a perimeter.
const WEAKENING_PHRASES: &[&str] = &[
    "turn off the filter",
    "turn off oath light",
    "turn oath light off",
    "disable the filter",
    "disable oath light",
    "disable the blocker",
    "uninstall oath light",
    "uninstall the app",
    "remove the extension",
    "delete oath light",
    "bypass the filter",
    "bypass oath light",
    "get around the filter",
    "get around the block",
    "get past the filter",
    "get past the block",
    "unblock the site",
    "unblock a site",
    "how do i unblock",
    "skip the cooldown",
    "skip the cool-off",
    "skip the waiting period",
    "shorten the waiting period",
    "cancel the waiting period",
    "end lockdown early",
    "get out of lockdown",
    "reset the timer",
    "master password reset",
    "forgot my master password",
    "work around the block",
    "circumvent the filter",
    "defeat the filter",
    "turn off serious mode",
    "disable serious mode",
];

/// True when `message` reads as a request to weaken protection. Layer 2.
pub fn weakening_intent(message: &str) -> bool {
    let m = message.to_lowercase();
    WEAKENING_PHRASES.iter().any(|p| m.contains(p))
}

// ============================================================================
// Layer 3 — output guard
// ============================================================================

/// Why a reply was dropped. Surfaced to the UI as a neutral notice rather
/// than the raw text, because showing the user "here is what I refused to
/// show you" would defeat the point of refusing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardFail {
    /// The reply contained a hostname on the blocklist, or one the keyword
    /// engine flags. The single failure this guard exists to prevent.
    BlockedDomain,
    /// The model returned nothing usable (all thinking, no text).
    Empty,
}

impl GuardFail {
    pub fn message(self) -> &'static str {
        match self {
            GuardFail::BlockedDomain =>
                "That reply was withheld — it contained a site this filter blocks. \
                 Nothing you typed was affected, and this was caught on your own \
                 machine, not reported anywhere.",
            GuardFail::Empty => "No reply came back. Try again in a moment.",
        }
    }
}

/// Pull anything hostname-shaped out of free text. Deliberately loose: it is
/// better to hand a few non-hostnames ("e.g.", "3.5") to the matcher — which
/// simply won't match them — than to miss a real one because it was wrapped
/// in punctuation or written without a scheme.
fn extract_hosts(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for raw in text.split(|c: char| c.is_whitespace() || matches!(c, '(' | ')' | '<' | '>' | '"' | '\'' | '[' | ']' | ',')) {
        let token = raw.trim_matches(|c: char| !c.is_alphanumeric());
        if token.len() < 4 || !token.contains('.') {
            continue;
        }
        let host = lists::normalize_domain(token);
        // A bare "1.5" or "e.g" has no TLD-shaped tail; require at least two
        // labels with an alphabetic last label.
        let parts: Vec<&str> = host.split('.').collect();
        if parts.len() < 2 {
            continue;
        }
        let tld = parts[parts.len() - 1];
        if tld.len() < 2 || !tld.chars().all(|c| c.is_ascii_alphabetic()) {
            continue;
        }
        out.push(host);
    }
    out
}

/// Layer 3. Runs the model's reply through the same two engines the filter
/// itself uses — the effective domain list (OTA overlay when installed,
/// baked built-ins otherwise) and the multilingual keyword matcher — and
/// rejects the whole reply if any hostname in it would be blocked.
///
/// Whole-reply rejection rather than redaction is deliberate: a redacted
/// reply still tells the user a site exists and roughly where to look, which
/// is most of the harm.
pub fn guard_reply(text: &str) -> Result<String, GuardFail> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(GuardFail::Empty);
    }
    let effective = lists::effective();
    let domains = effective.domains();
    for host in extract_hosts(trimmed) {
        // The allowlist wins, same precedence as the filter itself — otherwise
        // a mentor mentioning a mainstream domain in passing trips the
        // keyword engine on a substring and the reply vanishes for no reason.
        if matching::is_whitelisted_domain(&host) {
            continue;
        }
        if lists::is_domain_listed(&host, domains) {
            return Err(GuardFail::BlockedDomain);
        }
        if matching::check_domain_keywords(&host).is_some() {
            return Err(GuardFail::BlockedDomain);
        }
    }
    Ok(trimmed.to_string())
}

// ============================================================================
// Wire types
// ============================================================================

/// One turn of the conversation, as the renderer holds it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    /// `"user"` or `"assistant"`. Anything else is dropped before sending.
    pub role: String,
    pub text: String,
}

/// What a send resolves to. `blocked_locally` is true when the pre-filter or
/// the output guard produced the text instead of the model — the UI labels
/// those differently, because attributing a canned local refusal to "the AI"
/// would be a small lie about what just happened.
#[derive(Debug, Clone, Serialize)]
pub struct MentorReply {
    pub text: String,
    pub blocked_locally: bool,
    /// Model that actually produced the reply (may differ from the requested
    /// one when a server-side fallback ran). Empty for a local reply.
    pub model: String,
}

// ============================================================================
// The call
// ============================================================================

/// Send `history` (oldest first, ending with the user's new message) and
/// return the reply. Blocking: callers must run this off the UI thread.
///
/// Ordering matters and is not an accident — the pre-filter runs before the
/// key is even read, so a weakening request costs nothing and reveals
/// nothing.
pub fn send(
    provider_id: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
    history: &[Turn],
) -> Result<MentorReply, String> {
    let last_user = history
        .iter()
        .rev()
        .find(|t| t.role == "user")
        .ok_or_else(|| "no user message to send".to_string())?;

    if last_user.text.trim().is_empty() {
        return Err("message is empty".to_string());
    }
    if last_user.text.chars().count() > MAX_MESSAGE_CHARS {
        return Err(format!("message is too long (limit {MAX_MESSAGE_CHARS} characters)"));
    }

    // Layer 2 — before the network, before the key, and before the provider is
    // even resolved. A weakening request costs nothing and reveals nothing.
    if weakening_intent(&last_user.text) {
        return Ok(MentorReply {
            text: WEAKENING_REPLY.to_string(),
            blocked_locally: true,
            model: String::new(),
        });
    }

    let provider = provider_by_id(provider_id);

    // A local server (Ollama/LM Studio/vLLM) legitimately has no key, so the
    // key is only mandatory for the hosted providers. `custom` instead requires
    // a base URL, which is the thing it cannot work without.
    let key = api_key.trim();
    let base = if provider.id == "custom" { base_url.trim() } else { provider.base_url };
    if provider.id == "custom" {
        if base.is_empty() {
            return Err("no server URL set for the custom provider".to_string());
        }
    } else if key.is_empty() {
        return Err("no API key set".to_string());
    }

    let start = history.len().saturating_sub(MAX_HISTORY_TURNS);
    let messages: Vec<serde_json::Value> = history[start..]
        .iter()
        .filter(|t| (t.role == "user" || t.role == "assistant") && !t.text.trim().is_empty())
        .map(|t| serde_json::json!({ "role": t.role, "content": t.text }))
        .collect();
    if messages.is_empty() {
        return Err("nothing to send".to_string());
    }

    let model = match (model.trim(), provider.default_model) {
        ("", "") => return Err("no model set — the custom provider needs one".to_string()),
        ("", d) => d,
        (m, _) => m,
    };

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_TIMEOUT)
        .build();

    let (text, served_by) = match provider.wire {
        Wire::Anthropic => call_anthropic(&agent, base, key, model, &messages)?,
        Wire::OpenAi => call_openai(&agent, base, key, model, &messages)?,
    };

    // A refusal short-circuits with its own message rather than falling into
    // the guard, which would report it as a withheld reply.
    if text.is_empty() && served_by.is_empty() {
        return Ok(MentorReply {
            text: "The model declined to answer that one. Rephrasing usually helps — \
                   and if it doesn't, the guided exercises don't involve a model at all."
                .to_string(),
            blocked_locally: true,
            model: String::new(),
        });
    }

    // Layer 3.
    match guard_reply(&text) {
        Ok(clean) => Ok(MentorReply { text: clean, blocked_locally: false, model: served_by }),
        Err(fail) => Ok(MentorReply {
            text: fail.message().to_string(),
            blocked_locally: true,
            model: String::new(),
        }),
    }
}

/// Read and size-cap a response body, then parse it as JSON.
fn read_json(resp: ureq::Response) -> Result<serde_json::Value, String> {
    let mut raw = Vec::new();
    resp.into_reader()
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut raw)
        .map_err(|e| format!("could not read the reply: {e}"))?;
    if raw.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("the reply was implausibly large and was discarded".to_string());
    }
    serde_json::from_slice(&raw).map_err(|e| format!("could not parse the reply: {e}"))
}

/// Anthropic Messages API. Returns `(text, served_by_model)`; an empty pair
/// signals a classifier refusal, which `send` renders as its own message.
///
/// No `tools` key, and there never will be one — see layer 1. `thinking` is
/// left at its default (on, adaptive on Opus 5) because disabling it has known
/// failure modes; `effort: low` is what keeps a short chat turn cheap instead.
fn call_anthropic(
    agent: &ureq::Agent,
    base: &str,
    api_key: &str,
    model: &str,
    messages: &[serde_json::Value],
) -> Result<(String, String), String> {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "output_config": { "effort": "low" },
        "fallbacks": "default",
    });
    // `send_string` rather than `send_json`: the latter lives behind ureq's
    // `json` feature, which the workspace does not enable (ota.rs only ever
    // GETs bytes). Serializing here costs one allocation and keeps the
    // dependency surface exactly as it was — the explicit content-type header
    // is what makes it a JSON request either way.
    let payload =
        serde_json::to_string(&body).map_err(|e| format!("could not build the request: {e}"))?;

    let resp = agent
        .post(&format!("{}/v1/messages", base.trim_end_matches('/')))
        .set("x-api-key", api_key)
        .set("anthropic-version", API_VERSION)
        .set("anthropic-beta", BETA_FALLBACKS)
        .set("content-type", "application/json")
        .send_string(&payload)
        .map_err(describe_error)?;

    let json = read_json(resp)?;

    // Check the stop reason BEFORE reading content: a classifier refusal
    // returns HTTP 200 with empty or partial content, so code that indexes
    // straight into content[0] breaks here rather than reporting honestly.
    if json.get("stop_reason").and_then(|v| v.as_str()) == Some("refusal") {
        return Ok((String::new(), String::new()));
    }

    // Concatenate every `text` block. Blocks of other types (`thinking`,
    // `fallback`) are skipped rather than rendered — a `fallback` block is an
    // audit marker for a model switch, not something to show the user.
    let text = json
        .get("content")
        .and_then(|c| c.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) != Some("text") {
                        return None;
                    }
                    b.get("text").and_then(|t| t.as_str())
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    let served_by = json.get("model").and_then(|m| m.as_str()).unwrap_or(model).to_string();
    Ok((text, served_by))
}

/// OpenAI-compatible chat-completions. Covers OpenAI, Google's compat endpoint,
/// OpenRouter, Groq, Mistral and any local server speaking the same shape.
///
/// Differences from the Anthropic call that actually matter: the system prompt
/// is the first message rather than a top-level field, `max_tokens` is
/// `max_completion_tokens` on current OpenAI models, and the reply is a plain
/// string at `choices[0].message.content`. No `tools` key here either.
fn call_openai(
    agent: &ureq::Agent,
    base: &str,
    api_key: &str,
    model: &str,
    messages: &[serde_json::Value],
) -> Result<(String, String), String> {
    let mut msgs = Vec::with_capacity(messages.len() + 1);
    msgs.push(serde_json::json!({ "role": "system", "content": SYSTEM_PROMPT }));
    msgs.extend(messages.iter().cloned());

    let body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "max_completion_tokens": MAX_TOKENS,
    });
    let payload =
        serde_json::to_string(&body).map_err(|e| format!("could not build the request: {e}"))?;

    let mut req = agent
        .post(&format!("{}/chat/completions", base.trim_end_matches('/')))
        .set("content-type", "application/json");
    // A local server usually wants no auth at all; sending an empty bearer
    // token makes some of them reject the request outright.
    if !api_key.is_empty() {
        req = req.set("authorization", &format!("Bearer {api_key}"));
    }

    let json = read_json(req.send_string(&payload).map_err(describe_error)?)?;

    let choice = json.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first());

    // OpenAI-compatible refusals surface either as an explicit `refusal` field
    // or as `finish_reason: "content_filter"`. Both mean "no answer", which is
    // the same empty-pair signal the Anthropic path uses.
    let refused = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(|f| f.as_str())
        == Some("content_filter")
        || choice
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("refusal"))
            .map(|r| !r.is_null())
            .unwrap_or(false);
    if refused {
        return Ok((String::new(), String::new()));
    }

    let text = choice
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or_default()
        .to_string();

    let served_by = json.get("model").and_then(|m| m.as_str()).unwrap_or(model).to_string();
    Ok((text, served_by))
}

/// Turn a ureq failure into something worth showing a user. The API's own
/// error body is far more useful than "400 Bad Request" (it names the bad
/// field), and a bad key is by far the most common real failure — so that
/// one gets a plain sentence instead of a status code.
fn describe_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, resp) => {
            let detail = resp
                .into_string()
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| {
                    v.get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                        .map(String::from)
                })
                .unwrap_or_default();
            match code {
                401 => "That API key was rejected. Check it in Settings.".to_string(),
                429 => "Rate limited by the API. Wait a moment and try again.".to_string(),
                529 => "The API is overloaded right now. Try again shortly.".to_string(),
                _ if !detail.is_empty() => format!("API error {code}: {detail}"),
                _ => format!("API error {code}."),
            }
        }
        // Binding catch-all rather than naming `Transport` explicitly: ureq's
        // error enum may gain variants, and a non-exhaustive match would then
        // stop compiling on a patch bump. Transport failures are the only
        // other case today and read correctly through Display.
        other => format!("Could not reach the API: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weakening_phrases_are_caught_case_insensitively() {
        assert!(weakening_intent("How do I turn off the filter?"));
        assert!(weakening_intent("PLEASE HELP ME BYPASS THE FILTER"));
        assert!(weakening_intent("i want to uninstall oath light tonight"));
        assert!(weakening_intent("can you help me skip the waiting period"));
    }

    #[test]
    fn ordinary_conversation_is_not_caught() {
        // The whole point of phrase-matching over word-matching: a support
        // tool that refuses to discuss feeling "off" or turning off the
        // lights is one nobody opens twice.
        assert!(!weakening_intent("I feel off today and I don't know why"));
        assert!(!weakening_intent("I turned off my phone and went for a walk"));
        assert!(!weakening_intent("Should I disable notifications at night?"));
        assert!(!weakening_intent("I had a slip last night and I feel awful"));
        assert!(!weakening_intent("What helps when the urge hits after work?"));
    }

    #[test]
    fn guard_rejects_a_reply_containing_a_blocked_domain() {
        // Uses the keyword engine rather than a hardcoded list entry so the
        // test doesn't depend on any particular domain staying on the list.
        let reply = "You could try visiting freepornhub.com instead.";
        assert_eq!(guard_reply(reply), Err(GuardFail::BlockedDomain));
    }

    #[test]
    fn guard_allows_ordinary_prose_and_mainstream_domains() {
        assert!(guard_reply("That sounds exhausting. What happened just before?").is_ok());
        assert!(guard_reply("Try a walk, or read something on wikipedia.org.").is_ok());
        // Trap words: the keyword engine must not fire on "essex"/"analytics",
        // and this guard must inherit that behavior rather than re-deriving it.
        assert!(guard_reply("The Essex meetup is listed on essex.gov.uk.").is_ok());
    }

    #[test]
    fn guard_rejects_an_empty_reply() {
        assert_eq!(guard_reply("   "), Err(GuardFail::Empty));
    }

    #[test]
    fn extract_hosts_ignores_version_numbers_and_prose() {
        let hosts = extract_hosts("Version 1.5 shipped. See example.com, or e.g. other.org.");
        assert!(hosts.contains(&"example.com".to_string()));
        assert!(hosts.contains(&"other.org".to_string()));
        assert!(!hosts.iter().any(|h| h.starts_with("1.")));
    }

    #[test]
    fn send_short_circuits_a_weakening_request_without_a_key() {
        // No key, no network: the pre-filter must answer before either is
        // needed. If this ever starts erroring with "no API key set", the
        // ordering in `send` has regressed and layer 2 has moved behind the
        // network boundary.
        let history = vec![Turn { role: "user".into(), text: "how do i bypass the filter".into() }];
        let reply =
            send("", "", "", "", &history).expect("pre-filter should answer locally");
        assert!(reply.blocked_locally);
        assert_eq!(reply.text, WEAKENING_REPLY);
    }

    #[test]
    fn layer_two_short_circuits_for_every_provider() {
        // The whole point of the provider split is that it only changes the
        // HTTP call. If a provider could ever reach the network with a
        // weakening request, layer 2 would have become provider-specific —
        // which is exactly the regression this guards.
        let history = vec![Turn { role: "user".into(), text: "help me uninstall oath light".into() }];
        for p in PROVIDERS {
            let reply = send(p.id, "http://127.0.0.1:1", "k", "m", &history)
                .unwrap_or_else(|e| panic!("provider {} reached the network: {e}", p.id));
            assert!(reply.blocked_locally, "provider {} did not block locally", p.id);
            assert_eq!(reply.text, WEAKENING_REPLY, "provider {}", p.id);
        }
    }

    #[test]
    fn unknown_provider_falls_back_to_anthropic() {
        // An id from a newer build, or a hand-edited settings.json, must not
        // leave the mentor pointing at nothing.
        assert_eq!(provider_by_id("").id, "anthropic");
        assert_eq!(provider_by_id("nonsense").id, "anthropic");
        assert_eq!(provider_by_id("openai").id, "openai");
    }

    #[test]
    fn every_provider_is_well_formed() {
        for p in PROVIDERS {
            assert!(!p.id.is_empty() && !p.name.is_empty(), "provider missing id/name");
            if p.id == "custom" {
                // The escape hatch supplies its own URL and model.
                assert!(p.base_url.is_empty() && p.default_model.is_empty());
            } else {
                assert!(p.base_url.starts_with("https://"), "{} must be https", p.id);
                assert!(!p.default_model.is_empty(), "{} needs a default model", p.id);
            }
        }
        // Ids must be unique — `provider_by_id` returns the first match.
        let mut ids: Vec<&str> = PROVIDERS.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "duplicate provider id");
    }
}

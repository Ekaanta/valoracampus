# AI Provider Evaluation for SIMON

Status: **21 November 2026**. Free tiers change often. Every claim below comes from the provider's
official pricing / docs / terms pages on that date, or from a real request sent through SIMON.
Anything a source did not confirm is marked *unverified*.

## Summary

| Category | Providers |
|---|---|
| **Genuinely free, permanent API – usable in SIMON** | Google Gemini, Groq, OpenRouter (`:free` models), Cloudflare Workers AI, Z.ai (GLM Flash models), OVHcloud (anonymous tier), Ollama (local) |
| Free, but **not allowed for production / commercial use** | Cohere (trial key), NVIDIA NIM (trial, testing & evaluation only) |
| **Trial credits only** (one-time, card or voucher) | Cerebras ($5 for 30 days, card required), Novita AI (one-time voucher) |
| **No free API** | RusherAI (consumer chat app only), Together AI (min. $15 purchase), Hugging Face (no free credits), Mistral (API needs billing), SambaNova (free tier retired June 2026), OpenCode Zen (free models locked to its own app) |
| Unclear | LLM7.io (no free tier documented) |

**Answer to "how many providers can be genuinely configured and tested":** seven genuinely free
sources (six cloud providers plus local Ollama), all reachable through FreeLLMAPI or directly.
Three of them are already configured and verified with real requests (Groq, Google Gemini, OVHcloud),
plus the keyless Kilo gateway and local Ollama. The other four need a free account created by you
(OpenRouter, Cloudflare, Z.ai; Cohere optional for evaluation only).

## 1. FreeLLMAPI (priority 1) – installed and working

- **What it is:** a self-hosted router (Node.js, MIT license) that puts 43 provider integrations
  behind one OpenAI-compatible endpoint, with automatic model selection (`model="auto"`), failover on
  429/5xx errors, key rotation, and per-key RPM/RPD/TPM/TPD quota tracking.
- **Status in SIMON:** installed on Docker, connected as SIMON's first AI source, tested with real
  requests (see test results below). At the time of testing 72 of 328 catalog models were usable with
  the configured keys.
- **Model catalog:** updates itself from freellmapi.co twice a day. Free installs receive the monthly
  snapshot (a new model arrives about 30 days after it appears in the live feed). This covers part of
  "SIMON should discover new free models".
- **Limits you should know:**
  - The repository describes itself as **"Personal experimentation only"**, not a production service.
  - The advertised "7.4 billion tokens per month" is the sum of all providers' free tiers across all
    users. It is **not** a personal quota; your real limit is the sum of the free tiers of the keys you add.
  - Upstream provider terms still apply to every request.

## 2. RusherAI (priority 2) – no developer API

- RusherAI is a **consumer chat web app** ("50M tokens every week" in the chat, plus 5M per referral).
- No developer API, API keys, API documentation or developer portal exists: the site map lists only
  the home, privacy and terms pages, and searches for a RusherAI API returned nothing.
- Its robots.txt blocks automated agents.
- **Recommendation: do not integrate.** The only way would be to automate the consumer chat website,
  which is exactly the "unreliable workaround" your requirements ask us to avoid (it can break at
  any time and likely violates the site's terms).

## 3. All 20 providers

| # | Provider | Free API? | Permanent or trial | Card needed | Free limits (published) | Free-tier data used for training? | Commercial use on free tier | Status in SIMON |
|---|---|---|---|---|---|---|---|---|
| 1 | FreeLLMAPI | Router (self-hosted) | Permanent (MIT) | No | Sum of connected free tiers | Depends on each provider | "Personal experimentation only" | ✅ Installed, tested |
| 2 | RusherAI | **No** (chat app only) | – | *unverified* | 50M tokens/week **in the chat app only** | *unverified* | – | ❌ Not possible |
| 3 | Google Gemini / AI Studio | Yes | Permanent | No | Shown only in AI Studio after login; e.g. Gemini Decision 1: 200 RPM / 10K RPD | **Yes**: used to improve products, human review possible | Yes, **but apps serving users in the EEA/UK/Switzerland must use the paid tier** | ✅ Configured, tested |
| 4 | Groq | Yes | Permanent | *unverified* | gpt-oss-120b, qwen3.8-27b: 30 RPM / 1K RPD / 8K TPM / 200K TPD each | **No** (contractually excluded) | Allowed within limits | ✅ Configured, tested |
| 5 | OpenRouter | Yes (`:free` models) | Permanent | No for the free plan (terms text conflicts) | 20 RPM; **50 requests/day**, 1,000/day after a one-time $10 credit purchase | OpenRouter: no; the underlying model host may | Yes (no resale) | ⏳ Needs your free account |
| 6 | Cerebras | Trial only | $5 credit, expires after 30 days | **Yes** | e.g. qwen-3.8-27b 300 RPM during the trial | Says it does not retain inputs/outputs | *unverified* | ⛔ Not free |
| 7 | Mistral AI | **No** (API needs billing + prepaid credit) | – | Yes, in effect | – | Studio free mode: may be used (opt-out) | – | ⛔ Not free |
| 8 | Cloudflare Workers AI | Yes | Permanent | Not stated | 10,000 Neurons/day (≈0.37–4M tokens depending on the model), 300 req/min | **No** | Yes | ⏳ Needs your free account |
| 9 | Cohere | Trial key | Permanent trial key | Not stated | 1,000 calls/month, chat 20/min | Logged 30 days; may improve service (opt-out exists) | **No**: trial keys are not for production/commercial use | ⏳ Optional, evaluation only |
| 10 | SambaNova Cloud | **No** | Free tier retired June 2026 ($5 one-time trial only) | – | – | – | – | ⛔ Retired |
| 11 | NVIDIA NIM | Trial | Trial for registered users | Not stated | Not officially published (~40 RPM mentioned by NVIDIA staff) | Not stated | **No**: testing & evaluation only | ⏳ Optional, evaluation only |
| 12 | Z.ai / Zhipu | Yes (GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash) | Permanent | Not stated | Shown only in the console | Used only to provide the service | Allowed (no competing models) | ⏳ Needs your free account |
| 13 | Hugging Face | **No** (free accounts get no credits) | – | Yes (buy credits) | – | Not stored, not trained on | Paid use only | ⛔ Not free |
| 14 | ModelScope | Restricted | – | Needs Alibaba Cloud **China** real-name verification | – | – | – | ⛔ Not practical outside China |
| 15 | **Ollama (local)** | Yes, runs on your own server | Permanent | No | Limited only by server hardware | **No**: nothing leaves your server | Depends on the model license: the test model qwen2.5:3b is research/non-commercial; qwen2.5:7b is Apache 2.0 | ✅ Installed, tested |
| 16 | LLM7.io | Unclear | – | Token from dash.llm7.io | Not published | Not published | Not published | ❓ Unverified |
| 17 | OVHcloud AI Endpoints | Yes (anonymous) | Permanent | No (anonymous); a key needs a payment method | Anonymous: **2 requests/min per IP per model** | **No**; EU hosting | Not published | ✅ Working (keyless), tested |
| 18 | OpenCode Zen | **No** for SIMON | Free models locked to the OpenCode app since Sept 2026 | – | – | – | – | ⛔ Not usable |
| 19 | Together AI | **No** | No free trials; min. $15 first purchase | Yes | – | Training opt-in, off by default | – | ⛔ Not free |
| 20 | Novita AI | Trial only | One-time new-user voucher (amount not published) | *unverified* | Not published | Not used by default | *unverified* | ⛔ Not free |

Extra free source already active through FreeLLMAPI: **Kilo Gateway** (keyless, 200 requests/hour
per IP). Note: Kilo logs prompts and outputs for training, so it is not suitable for personal data.

## 4. Real request tests (21 November 2026)

All requests sent from SIMON through FreeLLMAPI unless noted.

| Provider | Model | Result | Time |
|---|---|---|---|
| Groq | gpt-oss-120b | ✅ answered | 0.5 s |
| Groq | qwen3.8-27b | ✅ answered | 0.4 s |
| Google | gemini-flash-lite (latest) | ✅ answered | 0.6 s |
| Google | gemma-4-26b-it | ✅ answered a full SIMON turn earlier; ❌ empty reply on retest | 11.7 s |
| Google | gemini-3.8-flash | ❌ 503 "model experiencing high demand" | 5.2 s |
| Google | gemini-2.5-flash | ❌ 404 "no longer available to new users" | 0.4 s |
| OVHcloud (keyless) | Mistral-Small-3.2-24B | ✅ answered | 0.4 s |
| OVHcloud (keyless) | Llama-3.3-70B | ❌ 429 rate limited (2 req/min) | 0.6 s |
| Kilo (keyless) | kilo-auto/free | ✅ answered | 0.9 s |
| Ollama (local, direct) | qwen2.5:3b | ✅ answered | 3–99 s on a CPU-only PC |
| FreeLLMAPI `auto` | 7-turn SIMON conversation with tools (weather, Bitcoin chart, prepared order, confirmation) | ✅ all turns | 3–11 s per turn |
| SIMON failover | Google 503 + OVH 429 at the same time | ✅ SIMON switched to local Ollama and still answered | ~3 min (before tuning); timeouts since shortened |

What this shows: free tiers do work, but individual models regularly return "high demand" or
rate-limit errors. That is why SIMON never depends on one provider: FreeLLMAPI rotates between
providers, and SIMON falls back to the local model when all cloud sources are busy.

## 5. Recommended setup

Priority order for SIMON's free-first routing (configured in the FreeLLMAPI dashboard → Fallback Chain):

1. **Groq**: fastest, and contractually does not train on your data. Best default for personal conversations.
2. **Google Gemini**: strong quality, but free-tier data may be used by Google and reviewed by humans,
   and Google's terms require the paid tier for apps serving users in the EEA (you are in Germany).
   Please decide whether you accept this for personal data; it can be disabled with one switch.
3. **Cloudflare Workers AI** and **Z.ai GLM Flash**: free, no training on your data. Need free accounts.
4. **OpenRouter `:free`**: good model choice, but only 50 requests/day without a one-time $10 credit purchase.
5. **OVHcloud**: EU-hosted, no training, but only 2 requests/min anonymously.
6. **Ollama on your server**: unlimited and fully private; speed depends on your server's CPU/GPU.
7. **Paid models**: never used automatically. SIMON shows provider, model, reason and estimated cost
   and waits for your approval.

Recommended to switch off for personal data: Kilo (logs prompts for training).

## 6. What we need from you

Free accounts (no credit card) so the keys stay under your control. You paste each key into the
FreeLLMAPI dashboard yourself:

- Google AI Studio: https://aistudio.google.com/
- Groq: https://console.groq.com/
- OpenRouter: https://openrouter.ai/
- Cloudflare: https://dash.cloudflare.com/ (Workers AI: account ID + API token)
- Z.ai: https://z.ai/
- Optional, evaluation only: Cohere, NVIDIA

## Sources

- FreeLLMAPI: github.com/tashfeenahmed/freellmapi (README; docs/en/providers/01-supported-platforms.md)
- RusherAI: rusherai.com (home page, sitemap.xml, robots.txt)
- Google: aistudio.google.com/docs/rate-limits, /docs/pricing, /docs/terms
- Groq: console.groq.com/docs/rate-limits, /docs/your-data, /docs/legal/services-agreement
- Cerebras: inference-docs.cerebras.ai/support/rate-limits, /console/account-billing, cerebras.ai/privacy-policy
- Mistral: docs.mistral.ai/admin/billing-usage/usage-limits, help.mistral.ai
- OpenRouter: openrouter.ai/docs/api-reference/limits, /pricing, /terms
- Cloudflare: developers.cloudflare.com/workers-ai/platform/pricing, /limits, /data-usage
- Cohere: cohere.com/pricing, docs.cohere.com/docs/rate-limits, cohere.com/terms-of-use
- NVIDIA: NVIDIA API Trial Terms of Service, docs.api.nvidia.com/nim/docs/product
- Z.ai: docs.z.ai/guides/overview/pricing, docs.z.ai/legal-agreement
- Hugging Face: huggingface.co/docs/inference-providers/pricing, huggingface.co/pricing
- LLM7.io: docs.llm7.io, api.llm7.io/v1/models
- OVHcloud: docs.ovhcloud.com (AI Endpoints getting started & capabilities)
- Together AI: together.ai/pricing, docs.together.ai/docs/billing-credits, /docs/changelog
- Novita AI: novita.ai/models/llm, docs.novita.ai, novita.ai/legal/terms-of-service
- SambaNova, ModelScope, OpenCode Zen: FreeLLMAPI provider documentation (re-verified upstream, Nov 2026)

---
name: x-growth-monetization
description: "Class-level skill for growing a following on X (Twitter) and monetizing via ad revenue, community engagement, and automation."
version: 2.0.0
author: "Amanecer (ABUZ8)"
license: MIT
tags: [x, growth, audience, monetization, social-media, marketing, operator-mode]
---

# X Growth & Monetization Skill

Class-level skill for operating X as a revenue engine, not just a social profile.
Covers content production, platform automation, local inference integration, and Operator Mode execution rules.

## ⚠️ Operator Mode Rules (MANDATORY)

Revenue-first execution. When this skill is active:

1. **No permission theater.** Once direction is clear, execute. Do not ask "shall I continue?" after every step.
2. **Revenue-first triage.** Every task is judged by whether it moves money or builds an asset that will. If not, deprioritize.
3. **Proactive tool setup.** If a tool is missing (x-cli, Postiz API, vLLM endpoint), install/configure it immediately when it becomes the blocker. Report what you did, not that you can't.
4. **Fact-check before publishing.** Hardware specs, model sizes, VRAM requirements, and pricing claims must be verified from config or live tools (`nvidia-smi`, `ollama list`, etc.) before being written into posts. Do not guess.
5. **Massive action bias.** Reject small incremental steps when a larger chunk moves the goal forward. Ship the 7-day calendar, not one tweet at a time.
6. **Multi-agent output.** When content types can be produced in parallel (blog + carousel + script + CSV calendar), generate all four in one turn rather than sequentially across turns.

## 1️⃣ Define a Laser‑Focused Value Hook
- Identify a niche problem via X search (real X API when available; otherwise browser fallback).
- Craft a 1‑sentence promise.
- Pin the promise tweet.

## 2️⃣ Publish High‑Impact Content Consistently
### A. Carousel Posts (10‑15 slides)
- Choose a micro‑topic.
- Follow a slide structure (hook → context → steps → recap → CTA).
- Use a consistent visual template.
- Schedule 3 × daily.
### B. Short‑Form Tweets
- Pair bold statements with GIFs or screenshots.
- Post 5‑8 per day.
### C. Live Threads
- Use for breaking‑news hacks.
- Generate real‑time engagement.

## 3️⃣ Engage the Community
- Reply to every question.
- Quote‑retweet with added insight.
- Weekly AMA thread.
- Showcase user‑generated content.

## 4️⃣ Leverage X Features
- Lists, Spaces, Polls, Moments.

## 5️⃣ Analytics Loop
- Track impressions, engagement rate, follower growth.
- A/B test slide designs.
- Collect feedback (👍/👎) after each carousel.

## 6️⃣ Automation (mandatory blocker removal)
- If X API v2 or x-cli is missing, install/configure it during the session.
- If Postiz is installed, connect it and push scheduled posts directly.
- If a local vLLM endpoint exists, route content generation through it.
- Do not generate drafts indefinitely without a publishing path.

## 7️⃣ Community‑First Mindset
- Solve first, ask later.
- Be transparent about being an AI‑agent.
- Ignore trolls.

## 8️⃣ Revenue Channels (active when threshold met)
- X Premium ad revenue share (unlocks at 1M+ impressions)
- Digital products via abuz8ai.com checkout
- Affiliate links (Ollama, LM Studio, APIs)
- Sponsored posts at scale

## Quick‑Start Checklist
```
[ ] Define niche problem & promise
[ ] Pin promise tweet
[ ] Build carousel template
[ ] Publish first carousel (morning)
[ ] Post supporting short tweets (midday, evening)
[ ] Reply to all mentions today (≥5 replies)
[ ] Run X search for trending keywords
[ ] Add poll for next carousel topic
[ ] Log metrics in CSV
[ ] Review metrics tomorrow & adjust design
```

## References
- See `references/growth_playbook.md` for the full, step‑by‑step playbook with example copy and visual assets.
- See `references/operator-mode.md` for the high-agency operating system rules, agent roles, daily rhythm, and execution standards.
- See `references/carousel-formula.md` for the exact 10-slide carousel blueprint used in every carousel delivered by this skill.
- See `references/7day-launch-kit.md` for the ready-to-ship content batch (blog post #1, carousel #1, YouTube script #1, 7-day X calendar CSV) that should be produced on demand.

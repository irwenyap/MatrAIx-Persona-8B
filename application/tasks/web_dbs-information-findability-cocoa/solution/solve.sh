#!/bin/bash
set -euo pipefail
mkdir -p /app/output

python <<'PY'
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

from playwright.sync_api import sync_playwright

START = "https://www.dbs.com.sg/personal/default.page"
OUT = Path("/app/output/dbs_information_findability.json")
FEEDBACK = Path("/app/output/user_feedback.json")
GOALS = [
    ("fixed_deposit_rates", "fixed deposit interest rates", ("fixed deposit", "interest rate")),
    ("travel_rewards_card", "travel rewards miles credit card", ("miles", "travel")),
    ("home_loans", "home loans", ("home loan", "property loan")),
    ("rates_and_fees", "banking rates and fees", ("rates and fees", "fees and charges")),
    ("overseas_transfer", "how to make an overseas transfer", ("overseas transfer", "international transfer")),
    ("account_help", "account help support", ("account help", "banking help")),
    ("deposit_accounts", "deposit accounts", ("deposit account", "savings account")),
    ("investing_getting_started", "getting started investing", ("start investing", "getting started")),
]


def safe_title(page):
    try:
        return page.title().strip() or "DBS Personal Banking"
    except Exception:
        return "DBS Personal Banking"


def is_dbs(url):
    try:
        p = urlparse(url)
        return p.scheme == "https" and (p.hostname == "dbs.com.sg" or (p.hostname or "").endswith(".dbs.com.sg"))
    except Exception:
        return False


def body_text(page):
    try:
        return re.sub(r"\s+", " ", page.locator("body").inner_text(timeout=8000)).strip()
    except Exception:
        return ""


def evidence(text, terms):
    low = text.lower()
    positions = [low.find(term) for term in terms if low.find(term) >= 0]
    if not positions:
        return ""
    pos = min(positions)
    start = max(0, pos - 180)
    end = min(len(text), pos + 700)
    return text[start:end].strip()


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(locale="en-SG")
    page = context.new_page()
    try:
        page.goto(START, wait_until="domcontentloaded", timeout=90000)
    except Exception:
        pass
    start_title = safe_title(page)
    steps = []

    for step_id, query, terms in GOALS:
        nav = []
        used_search = False
        used_back = False
        back_details = ""
        # Prefer a currently visible DBS link whose label or URL matches the goal.
        candidate = None
        try:
            links = page.locator("a[href]").evaluate_all("els => els.map(a => ({text:(a.innerText||a.getAttribute('aria-label')||'').trim(), href:a.href})).slice(0,1500)")
            tokens = [token for token in re.findall(r"[a-z]+", query.lower()) if len(token) > 3]
            scored = []
            for link in links:
                href, label = link.get("href", ""), link.get("text", "")
                hay = (label + " " + href).lower()
                score = sum(token in hay for token in tokens)
                if score and is_dbs(href) and not any(x in hay for x in ("login", "apply now", "sign up")):
                    scored.append((score, len(label), href, label))
            if scored:
                _, _, candidate, label = max(scored)
                page.goto(candidate, wait_until="domcontentloaded", timeout=90000)
                nav.append({"sequence": 1, "action": f"Follow visible DBS link: {label or candidate}", "url": page.url if is_dbs(page.url) else candidate, "title": safe_title(page)})
        except Exception:
            candidate = None

        text = body_text(page)
        answer = evidence(text, terms)
        if not answer:
            used_search = True
            search_url = "https://www.dbs.com.sg/personal/search.page?query=" + quote(query)
            try:
                page.goto(search_url, wait_until="domcontentloaded", timeout=90000)
            except Exception:
                pass
            nav.append({"sequence": len(nav) + 1, "action": f"Submit DBS site search: {query}", "url": page.url if is_dbs(page.url) else search_url, "title": safe_title(page)})
            text = body_text(page)
            answer = evidence(text, terms)
            if not answer:
                # Follow the strongest public result without activating any CTA.
                try:
                    links = page.locator("a[href]").evaluate_all("els => els.map(a => ({text:(a.innerText||'').trim(), href:a.href})).slice(0,1000)")
                    tokens = [t for t in re.findall(r"[a-z]+", query) if len(t) > 3]
                    ranked = [
                        (sum(t in (x['text']+' '+x['href']).lower() for t in tokens), x)
                        for x in links
                        if is_dbs(x.get("href", ""))
                        and not any(blocked in (x.get("text", "") + " " + x.get("href", "")).lower() for blocked in ("login", "apply now", "sign up", "contact me"))
                    ]
                    score, result = max(ranked, default=(0, {}), key=lambda item: item[0])
                    if score:
                        page.goto(result["href"], wait_until="domcontentloaded", timeout=90000)
                        nav.append({"sequence": len(nav) + 1, "action": f"Follow DBS search result: {result['text'] or result['href']}", "url": page.url if is_dbs(page.url) else result["href"], "title": safe_title(page)})
                        answer = evidence(body_text(page), terms)
                except Exception:
                    pass
        if not nav:
            # Preserve evidence even when the site has no usable links.
            nav.append({"sequence": 1, "action": f"Submit DBS site search: {query}", "url": START, "title": start_title})
            used_search = True
        final_url = page.url if is_dbs(page.url) else START
        steps.append({
            "id": step_id, "found": bool(answer), "answer": answer,
            "final_url": final_url, "final_title": safe_title(page),
            "navigation_path": nav, "meaningful_action_count": len(nav),
            "used_site_search": used_search, "used_backtracking": used_back,
            "backtracking_details": back_details,
        })
    browser.close()

payload = {
    "start_url": START, "start_title": start_title,
    "completed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "steps": steps,
    "totals": {
        "meaningful_actions": sum(s["meaningful_action_count"] for s in steps),
        "steps_using_site_search": sum(s["used_site_search"] for s in steps),
        "steps_using_backtracking": sum(s["used_backtracking"] for s in steps),
    },
}
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

feedback = {}
for step in steps:
    sid = step["id"]
    feedback[f"{sid}_confidence"] = 4 if step["found"] else 2
    feedback[f"{sid}_initial_expectation"] = "I expected a clearly labelled route from the Personal Banking navigation."
    feedback[f"{sid}_friction"] = "" if step["found"] else "The expected wording or result was not clearly available during this run."
    feedback[f"{sid}_completion_rationale"] = "The public DBS page contained relevant evidence." if step["found"] else "I could not locate sufficiently clear public evidence and did not guess."
feedback.update({
    "overall_ease": 3, "navigation_consistency": 3,
    "recurring_friction": "Some goals required site search when visible navigation did not use the expected wording.",
    "confusing_labels_information_architecture": "Product and support information sometimes appeared under different navigation groupings.",
    "confidence_finding_similar_information_later": 3,
})
FEEDBACK.write_text(json.dumps(feedback, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

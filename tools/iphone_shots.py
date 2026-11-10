"""Health view as an iPhone in WebKit (Safari's engine) with the real data: screenshots of the first charts per range.

Setup once: python -m pip install playwright && python -m playwright install webkit
Serve the folder that holds both repos (fitnessassistant + fitness-data side by side):
    cd .. && python -m http.server 8765 --bind 127.0.0.1
Then: python tools/iphone_shots.py ["iPhone 15" | "iPhone SE"] [30 7 ...]   -> PNGs in %TEMP%/fa-shots
"""
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(tempfile.gettempdir()) / "fa-shots"
OUT.mkdir(exist_ok=True)
BASE = "http://127.0.0.1:8765"
device = sys.argv[1] if len(sys.argv) > 1 else "iPhone 15"

SEED = """async () => {
  const { mergeHealthDocs } = await import('./js/health.js');
  const docs = await Promise.all(['whoop','polar'].map(n => fetch(`/fitness-data/health/${n}.json`).then(r => r.json())));
  localStorage.setItem('style','hud'); localStorage.setItem('fa.health', JSON.stringify(mergeHealthDocs(docs)));
  localStorage.setItem('fa.trainingLog', JSON.stringify(await fetch('/fitness-data/training-log.json').then(r => r.json())));
  localStorage.setItem('fa.journal', JSON.stringify(await fetch('/fitness-data/journal.json').then(r => r.json())));
}"""

with sync_playwright() as p:
    browser = p.webkit.launch()
    ctx = browser.new_context(**p.devices[device])
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and print("console:", m.text))
    page.on("pageerror", lambda e: print("pageerror:", e))
    page.goto(f"{BASE}/fitnessassistant/")
    page.evaluate(SEED)
    page.reload()
    page.wait_for_timeout(1500)
    for rng in sys.argv[2:] or ["30", "7"]:
        page.click(f'[data-range="{rng}"]')
        page.wait_for_timeout(500)
        charts = page.locator("#health-view .card").filter(has=page.locator("svg"))
        for i in range(min(charts.count(), 4)):
            card = charts.nth(i)
            card.scroll_into_view_if_needed()
            card.screenshot(path=str(OUT / f"{device.replace(' ', '')}-{rng}d-{i}.png"))
    print("vw", page.evaluate("innerWidth"), "dpr", page.evaluate("devicePixelRatio"))
    browser.close()

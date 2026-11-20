"""Collect the analysis results into one small JSON file for the results page.

    python scripts/export_results.py      -> frontend/public/results.json (committed)

Reads the reports written by time_lost.py, scheduler.py and transfer.py (all
gitignored, built from 20 days of history) and keeps only what the page charts, so
the deployed site doesn't need the raw data. Re-run after those scripts.
"""
import json
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
DATA = HERE / "data"
OUT = HERE / "frontend" / "public" / "results.json"
AIRPORTS = [("KBOS", "Logan"), ("KJFK", "JFK"), ("EGLL", "Heathrow")]
TRAFFIC = [("0", "0-9"), ("10", "10-19"), ("20", "20-29"), ("30", "30-39"), ("40", "40+")]
SCHED_BUCKETS = ["20-29", "30-39", "40+"]


def load(path):
    return json.loads(path.read_text())


def main():
    out = {"generated": date.today().isoformat(), "airports": [], "time_lost": {}, "scheduler": {}, "transfer": {}}
    for icao, name in AIRPORTS:
        out["airports"].append({"icao": icao, "name": name})
        t = load(DATA / "time_lost" / f"{icao}.json")
        out["time_lost"][icao] = {
            "days": t["days"], "flights": t["measured"], "mean_min": t["overall"]["mean_min"],
            "median_min": t["overall"]["median_min"], "over_5_pct": t["overall"]["over_5_min_pct"],
            "holding_pct": t["holding_pct"], "total_hours": t["total_hours_lost"],
            "by_traffic": [{"bucket": label, "mean_min": t["by_landings_per_hour"][k]["mean_min"],
                            "flights": t["by_landings_per_hour"][k]["flights"]}
                           for k, label in TRAFFIC if k in t["by_landings_per_hour"]],
            "by_hour": [{"hour": int(h), "mean_min": v["mean_min"], "flights": v["flights"]}
                        for h, v in sorted(t["by_hour_local"].items(), key=lambda kv: int(kv[0]))],
        }
        s = load(DATA / "scheduler" / f"{icao}.json")
        floor = s["real_quiet_hours_floor_min"]
        out["scheduler"][icao] = {
            "quiet_floor_min": floor,
            "by_traffic": [{
                "bucket": b, "hours": s["by_landings_per_hour"][b]["hours"],
                "real_min": round(s["by_landings_per_hour"][b]["real_mean_min"] - floor, 2),
                "fcfs_min": s["by_landings_per_hour"][b]["fcfs_mean_min"],
                "optimizer_min": s["by_landings_per_hour"][b]["cps3_mean_min"],
                "optimizer_runways_min": s["by_landings_per_hour"][b]["runway_choice_cps3_mean_min"],
            } for b in SCHED_BUCKETS if b in s["by_landings_per_hour"]],
            "runway_choice_moved_pct": s["runway_choice_switched_pct"],
        }
    tr = load(DATA / "models" / "TRANSFER_report.json")
    for icao, _ in AIRPORTS:
        e, a = tr["eta"][icao], tr["arrival"][icao]
        days = sorted({int(k) for k in list(e["local"]) + list(e["transfer"]) + list(a["local"]) + list(a["transfer"])})
        out["transfer"][icao] = {
            "straight_line_mae_min": e["straight_line_mae_min"],
            "old_rule": a["old_rule"],
            "rows": [{
                "days": d,
                "eta_local": e["local"].get(str(d), {}).get("mae_min"),
                "eta_transfer": e["transfer"].get(str(d), {}).get("mae_min"),
                "arr_local_precision": a["local"].get(str(d), {}).get("precision_pct"),
                "arr_local_recall": a["local"].get(str(d), {}).get("recall_pct"),
                "arr_transfer_precision": a["transfer"].get(str(d), {}).get("precision_pct"),
                "arr_transfer_recall": a["transfer"].get(str(d), {}).get("recall_pct"),
            } for d in days],
        }
    OUT.write_text(json.dumps(out, indent=1))
    print(f"Wrote {OUT.relative_to(HERE)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

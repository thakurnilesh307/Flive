"""Deploy Flive to a Hugging Face Space (Docker SDK).

    pip install huggingface_hub
    hf auth login                                   # once, with a write token
    python scripts/deploy_space.py USER/flive       # or set HF_SPACE=USER/flive

Uploads the files git tracks plus the trained models (data/models/*.joblib, which are
gitignored), with deploy/space_README.md as the Space's README (it carries the Space
config). Hugging Face then builds the Dockerfile and starts the app. Re-run after
retraining or code changes; files removed from the repo are removed from the Space.
Secrets such as OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET go in the Space settings,
never in the upload.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "data" / "models"
SKIP = {"README.md"}            # replaced by the Space README


def main():
    repo_id = (sys.argv[1] if len(sys.argv) > 1 else os.getenv("HF_SPACE", "")).strip()
    if "/" not in repo_id:
        sys.exit("usage: python scripts/deploy_space.py USER/SPACE_NAME")
    try:
        from huggingface_hub import HfApi
    except ImportError:
        sys.exit("pip install huggingface_hub first")

    models = sorted(MODELS.glob("*.joblib"))
    if not models:
        sys.exit("No trained models in data/models; train them first.")
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True,
                             check=True).stdout.splitlines()
    for extra in ("Dockerfile", ".dockerignore"):
        if extra not in tracked and (ROOT / extra).exists():
            tracked.append(extra)

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        for rel in tracked:
            src = ROOT / rel
            if rel in SKIP or not src.is_file():
                continue
            (stage / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, stage / rel)
        (stage / "data" / "models").mkdir(parents=True, exist_ok=True)
        for m in models:
            shutil.copy2(m, stage / "data" / "models" / m.name)
        shutil.copy2(ROOT / "deploy" / "space_README.md", stage / "README.md")

        api = HfApi()
        api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)
        size = sum(p.stat().st_size for p in stage.rglob("*") if p.is_file())
        print(f"Uploading {sum(1 for p in stage.rglob('*') if p.is_file())} files "
              f"({size / 1e6:.1f} MB, {len(models)} models) to spaces/{repo_id} ...")
        api.upload_folder(
            folder_path=stage, repo_id=repo_id, repo_type="space",
            commit_message="Deploy from scripts/deploy_space.py",
            # remove files that no longer exist locally, but keep the Space's own .gitattributes
            delete_patterns=["*.py", "*.txt", "*.md", "*.json", "*.csv", "*.ts", "*.tsx",
                             "*.css", "*.html", "*.sh", "*.joblib", "Dockerfile", ".dockerignore"],
        )
    print(f"Done. Build log and app: https://huggingface.co/spaces/{repo_id}")


if __name__ == "__main__":
    main()

"""Vercel entry point: serves the SIMON API (backend/app) as a Python serverless function.

All /api/* requests are rewritten here by vercel.json; FastAPI still sees the original path.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401

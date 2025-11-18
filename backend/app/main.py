"""
Main FastAPI application - stub for testing.
This will be fully implemented later.
"""

from fastapi import FastAPI

app = FastAPI(title="Pulseboard API", version="0.1.0")


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "ok"}

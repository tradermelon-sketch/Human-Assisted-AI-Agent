import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.api.routes_manifest import router as manifest_router
from backend.app.api.routes_chat import router as chat_router
from backend.app.api.ws_execution import router as ws_router

# Read WORKSPACE_ROOT from environment, defaulting to the current directory
WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", os.path.abspath("."))

app = FastAPI(
    title="Human-Assisted AI Agent Backend",
    description="FastAPI service for the Proxy Tool-Use via UI Mediation arsitektur.",
    version="1.0.0"
)

# Configure CORS to allow secure local cross-origin requests from React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify the exact frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store workspace root in app state for access in route handlers
app.state.workspace_root = WORKSPACE_ROOT

# Include routers
app.include_router(manifest_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(ws_router)

@app.get("/api/health")
async def health_check():
    """
    Simple health check endpoint to verify backend status.
    """
    return {
        "status": "healthy",
        "workspace_root": WORKSPACE_ROOT
    }

if __name__ == "__main__":
    import uvicorn
    # Bind to standard port 8000 for local FastAPI testing
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

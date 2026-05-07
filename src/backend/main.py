from fastapi import FastAPI
from .api import router as api_router
from .admin import router as admin_router
from .db import init_db
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Backend + Solana Demo")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")
app.include_router(admin_router, prefix="/admin")

# Serve static frontend files (index.html, script.js, admin.html, admin.js, etc.)
from fastapi.staticfiles import StaticFiles
from fastapi import Request
from fastapi.responses import RedirectResponse
from fastapi.responses import PlainTextResponse
import os


@app.get("/admin")
def _admin_redirect(request: Request):
    # Serve admin UI (login handled client-side). Keep APIs protected server-side.
    return RedirectResponse(url="/admin.html")



@app.get("/api")
def _api_redirect():
    return RedirectResponse(url="/api/")


app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


@app.on_event("startup")
def on_startup():
    init_db()
    # Seed sample accounts for local testing
    try:
        from .db import seed_sample_accounts
        seed_sample_accounts()
    except Exception:
        pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)

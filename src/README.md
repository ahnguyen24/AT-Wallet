# SEC-Wallet Demo

This repo contains a FastAPI backend and a Create React App frontend. Instructions below show how to run both locally (backend on port 8000, frontend on port 3000).

## Backend (Python / FastAPI)

- Create and activate a virtual environment inside `backend/` or at workspace root.

Windows (PowerShell):
```
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

- Install dependencies:
```
pip install -r backend/requirements_src.txt
```

- Run the backend with uvicorn from the workspace root (so package `backend` is importable):
```
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

- The backend API will be available at `http://127.0.0.1:8000/api`.

Notes:
- `backend/main.py` configures CORS to allow `http://localhost:3000` and `http://127.0.0.1:3000`.
- If you use a different Python interpreter, ensure packages are installed into the active environment.

## Frontend (React)

- From the `frontend/` folder, install npm packages and start the dev server:
```
cd frontend
npm install
npm start
```

- The frontend dev server runs on `http://localhost:3000` by default and will call the backend API at `http://127.0.0.1:8000/api`.

## Fixes applied

- `backend/main.py`: middleware was added before creating the `FastAPI` app; reordered and added `127.0.0.1:3000` to allowed origins. See [backend/main.py](backend/main.py#L1-L50).
- `frontend/src/App.js`: fixed import to use the local `api.js` module. See [frontend/src/App.js](frontend/src/App.js#L1-L16).

## Troubleshooting

- If the frontend can't reach the backend, ensure the backend is running on port 8000 and check CORS.
- If `npm start` fails due to package version mismatches, consider using Node 16 or 18 and updating `react` version if necessary.

If you want, I can also run the backend tests or start the servers for you locally (I can provide the exact commands). 

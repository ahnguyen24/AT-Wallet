# Backend + Solana Demo

Quickstart (dev):

1. Create virtualenv and install deps:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r src/backend/requirements_src.txt
```

2. Start Redis (local) and `solana-test-validator` (install Solana CLI):

```bash
solana-test-validator
# start redis-server
```

3. Start RQ worker in project root:

```bash
rq worker
```

4. Start backend:

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload 
```

5. Run the demo:

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload 
```
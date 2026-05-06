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
uvicorn backend.main:app --reload --port 8000
```

5. Run the demo:

```bash
python src/backend/demo/demo_transfer.py
```

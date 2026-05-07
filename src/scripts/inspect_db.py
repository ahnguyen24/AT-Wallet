from backend.config import DATABASE_URL
import sqlite3, os
print('DATABASE_URL=', DATABASE_URL)
path = DATABASE_URL.replace('sqlite:///', '')
print('db path', path, 'exists', os.path.exists(path))
if os.path.exists(path):
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(users);")
    cols = cur.fetchall()
    print('users cols:')
    for c in cols:
        print(c)
    conn.close()
else:
    print('db file not found')

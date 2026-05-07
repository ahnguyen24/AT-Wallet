import requests
from requests.auth import HTTPBasicAuth

print('Checking user login (alice/password1)')
try:
    r = requests.post('http://127.0.0.1:8000/api/login', json={'username':'alice','password':'password1'}, timeout=5)
    print('USER_LOGIN', r.status_code)
    try:
        print(r.json())
    except Exception:
        print('body:', r.text[:500])
except Exception as e:
    print('User login request failed:', e)

print('\nChecking admin access (admin/admin123)')
try:
    r2 = requests.get('http://127.0.0.1:8000/admin/wallets', auth=HTTPBasicAuth('admin','admin123'), timeout=5)
    print('ADMIN_WALLETS', r2.status_code)
    try:
        print(r2.json()[:3])
    except Exception:
        print('body:', r2.text[:500])
except Exception as e:
    print('Admin request failed:', e)

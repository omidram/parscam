# -*- coding: utf-8 -*-
"""تست رمز عبور ذخیره‌شده"""
import os
import sys
import json
import hmac
import hashlib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUTH_FILE = os.path.join(BASE_DIR, "auth.json")

if not os.path.exists(AUTH_FILE):
    print(f"❌ فایل {AUTH_FILE} وجود ندارد.")
    sys.exit(1)

with open(AUTH_FILE, "r", encoding="utf-8") as f:
    auth = json.load(f)

print("=" * 60)
print(f"فایل: {AUTH_FILE}")
print(f"کاربر: {auth.get('username')}")
print(f"must_change: {auth.get('must_change')}")
print("=" * 60)

password = input("رمز عبور برای تست: ")

stored = auth.get("password_hash", "")
try:
    algo, iters, salt, hashval = stored.split("$")
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"),
        salt.encode("utf-8"), int(iters)
    )
    computed = dk.hex()
    print(f"  algo={algo}  iters={iters}")
    print(f"  expected: {hashval}")
    print(f"  computed: {computed}")
    match = hmac.compare_digest(computed, hashval)
    print()
    print(f"  ✅ MATCH: {match}" if match else f"  ❌ MATCH: {match}")
except Exception as e:
    print(f"❌ خطا: {e}")
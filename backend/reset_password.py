# -*- coding: utf-8 -*-
"""ریست رمز عبور پارس کم"""
import os
import sys
import json
import hashlib
import secrets
import getpass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUTH_FILE = os.path.join(BASE_DIR, "auth.json")


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"),
        salt.encode("utf-8"), 200_000
    )
    return f"pbkdf2_sha256$200000${salt}${dk.hex()}"


def verify_password(password, stored):
    import hmac
    algo, iters, salt, hashval = stored.split("$")
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"),
        salt.encode("utf-8"), int(iters)
    )
    return hmac.compare_digest(dk.hex(), hashval)


def main():
    print("=" * 60)
    print("  ریست رمز عبور پارس کم")
    print("=" * 60)

    username = input("نام کاربری [admin]: ").strip() or "admin"
    password = getpass.getpass("رمز عبور جدید (حداقل 8 کاراکتر): ")

    if len(password) < 8:
        print("❌ رمز خیلی کوتاه است.")
        sys.exit(1)

    confirm = getpass.getpass("تکرار رمز عبور: ")
    if password != confirm:
        print("❌ رمزها یکسان نیستند.")
        sys.exit(1)

    h = hash_password(password)

    # اعتبارسنجی فوری
    if not verify_password(password, h):
        print("❌ خطای داخلی در هش کردن رمز!")
        sys.exit(1)

    auth = {
        "username": username,
        "password_hash": h,
        "must_change": False,
    }

    tmp = AUTH_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(auth, f, indent=4, ensure_ascii=False)
    os.replace(tmp, AUTH_FILE)
    try:
        os.chmod(AUTH_FILE, 0o600)
    except OSError:
        pass

    print()
    print("=" * 60)
    print(f"✅ رمز عبور برای کاربر '{username}' ذخیره شد.")
    print(f"   فایل: {AUTH_FILE}")
    print("   الان می‌توانید برنامه را اجرا کنید و با این رمز وارد شوید.")
    print("=" * 60)


if __name__ == "__main__":
    main()
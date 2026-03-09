# 🔒 AmadeusX

**AmadeusX** is a web messenger with client-side End-to-End Encryption (E2EE), built on Flask, Socket.IO, and the Web Crypto API. The server never sees the content of the messages — it only stores encrypted text, and the encryption keys exist exclusively in the RAM of the user's browser.

---

## 📋 Table of Contents

1. [Key Features](#-key-features)
2. [Security Architecture](#-security-architecture)
3. [Tech Stack](#-tech-stack)
4. [Project Structure](#-project-structure)
5. [Data Models](#-data-models)
6. [API Routes](#-api-routes)
7. [Installation & Setup](#-installation--setup)
8. [Configuration](#-configuration)
9. [Theory: Automatic Server Self-Defense](#-theory-automatic-server-self-defense-upon-compromise)

---

## ✨ Key Features

### Messenger
- **Text Messages** — sent, received, encrypted/decrypted entirely in the browser.
- **Voice Messages** — microphone recording, audio encryption (WebM Opus).
- **Typing Indicator** — shows when the other person is typing.
- **Real-Time Communication** — Socket.IO with WebSocket transport.
- **Invitation System** — communication requires sending and accepting an invitation.
- **User Profiles** — avatars, password changes, account deletion.
- **Chat Deletion** — completely wipe a chat and its entire history.

### Security
- **End-to-End Encryption (E2EE)** — AES-256-GCM via Web Crypto API.
- **Zero-Knowledge Server** — the server stores only encrypted blobs.
- **Message Padding** — all text messages are padded to 4 KB to hide the actual length.
- **Coarse Timestamps** — the server stores time with an accuracy of ±5 minutes; the exact time is encrypted inside the message.
- **SRI (Subresource Integrity)** — JavaScript file hashes are verified by the browser upon loading.
- **Service Worker** — independent script integrity checks, protecting against server-side code tampering.
- **Key Fingerprints** — visual key verification via 8 emojis (protection against MITM).
- **Disappearing (Ephemeral) Messages** — automatic self-destruction after 30 seconds (removed from DOM and DB).
- **Auto-Lock Session** — the key is wiped from memory after 3 minutes of inactivity.
- **Hardened PBKDF2** — 600,000 iterations to protect encryption keys from brute-force attacks.
- **SQL Wildcard Injection Protection** — escaping `%` and `_` characters during search.
- **Timing-Safe Authentication** — protection against User Enumeration via response time analysis.
- **CSRF Protection** — Flask-WTF CSRFProtect on all forms and APIs.
- **Rate Limiting** — HTTP (200/day, 50/hour) and Socket.IO event limits (DoS protection).
- **Content Security Policy (CSP)** — strict policy with nonces for inline scripts.
- **Secure Cookies** — HttpOnly, SameSite=Lax, Secure.
- **Password Hashing** — Werkzeug (PBKDF2 + SHA-256).
- **Input Validation** — strict format checks, field length limits, and file upload restrictions (MIME types).
- **Secure DOM** — no use of `innerHTML` to prevent XSS vulnerabilities.

---

## 🛡 Security Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     ALICE'S BROWSER                      │
│                                                         │
│  Key: "Amadeus"   ──►  PBKDF2  ──►  AES-256-GCM Key     │
│                                                         │
│  "Hello"   ──►  padMessage(4KB)  ──►  encrypt()         │
│            ──►  "aGVsbG8gd29ybGQ..."  (base64)          │
│                                                         │
│  [🐻🎸🌍💎🚀🌈⭐🔑]  ◄──  SHA-256(key)  ──  Fingerprint │
└────────────────────────┬────────────────────────────────┘
                         │  HTTPS / WSS
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    SERVER (Flask)                        │
│                                                         │
│  Sees:      "aGVsbG8gd29ybGQ..."  (encrypted blob)     │
│  DOES NOT:  "Hello"                                     │
│  DOES NOT:  Key "Amadeus"                               │
│  DOES NOT:  Exact time (only ±5 mins)                   │
│  DOES NOT:  Message length (all = 4 KB)                 │
│                                                         │
│  PostgreSQL:  | id | chat_id | content (enc.) |         │
└────────────────────────┬────────────────────────────────┘
                         │  HTTPS / WSS
                         ▼
┌─────────────────────────────────────────────────────────┐
│                      BOB'S BROWSER                       │
│                                                         │
│  Key: "Amadeus"   ──►  decrypt()  ──►  "Hello"          │
│  [🐻🎸🌍💎🚀🌈⭐🔑]  ◄──  Same fingerprint? ✅          │
└─────────────────────────────────────────────────────────┘
```

### Defense Layers

| Threat | Defense Mechanism |
|--------|-------------------|
| Traffic Interception (Wi-Fi, ISP) | HTTPS/WSS + E2EE (AES-256-GCM) |
| Database Hack/Seizure | Zero-Knowledge — only encrypted blobs |
| Message Length Analysis | Padding to 4 KB |
| Send-Time Analysis | Coarse timestamps (±5 mins) |
| Server-Side JS Spoofing | SRI + Service Worker hash validation |
| MITM Attack on Key | Visual fingerprints (8 emojis) |
| Physical Device Access | Auto-lock after 3 mins + disappearing messages |
| CSRF Attacks | CSRFProtect + tokens |
| Brute-Force | Rate Limiting (Flask-Limiter) |
| XSS Injections | CSP with nonce + unsafe-inline disabled |
| Malicious File Uploads | MIME validation + file size limit (2 MB) |

---

## 🔧 Tech Stack

### Backend
| Technology | Purpose |
|------------|---------|
| Python 3.10+ | Server language |
| Flask 3.0 | Web framework |
| Flask-SocketIO 5.3 | WebSockets for real-time |
| Flask-Login 0.6 | Authentication and session management |
| Flask-SQLAlchemy 3.1 | ORM for PostgreSQL |
| Flask-WTF 1.2 | CSRF protection |
| Flask-Limiter 3.5 | Rate Limiting |
| Flask-Talisman 1.1 | Security headers (CSP, HSTS) |
| psycopg2 | PostgreSQL driver |
| python-magic | MIME validation for uploads |
| python-dotenv | Environment variables loader |

### Frontend
| Technology | Purpose |
|------------|---------|
| Vanilla JavaScript | All client-side logic |
| Web Crypto API | AES-256-GCM encryption, PBKDF2, SHA-256 |
| Socket.IO Client 4.7 | WebSocket connection |
| Service Worker API | Caching and script integrity checks |
| MediaRecorder API | Voice message recording |
| CSS3 | Styling (glassmorphism, gradients, animations) |
| Google Fonts (Inter) | Typography |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| PostgreSQL | Primary database |

---

## 📁 Project Structure

```
AmadeusX/
├── .gitignore                  # Protects root secrets
└── app/
    ├── .env                    # Environment variables (not in git)
    ├── .gitignore              # Ignored app files
    ├── app.py                  # Main application file (routes, SocketIO, security)
    ├── models.py               # SQLAlchemy models (User, Invitation, Chat, Message)
    ├── requirements.txt        # Python dependencies
    ├── fix_database.py         # Database migration script
    │
    ├── templates/
    │   ├── base.html           # Base template (key modal, SRI, Service Worker)
    │   ├── index.html          # Landing / welcome page
    │   ├── auth.html           # Registration and login
    │   ├── home.html           # Dashboard (search, invites, chat list)
    │   ├── chat.html           # Chat page (messages, fingerprint, ephemeral, lock)
    │   └── profile.html        # User profile (avatar, change password)
    │
    └── static/
        ├── favicon.ico         # Site icon
        ├── sw.js               # Service Worker (scripts.js integrity check)
        ├── scripts/
        │   └── scripts.js      # All client logic (encryption, UI, Socket.IO)
        ├── styles/
        │   └── style.css       # App styles
        ├── images/             # Static images
        └── uploads/
            └── avatars/        # Uploaded user avatars
```

---

## 📊 Data Models

### User
| Field | Type | Description |
|-------|------|-------------|
| id | Integer (PK) | Unique identifier |
| username | String(80) | Unique username |
| email | String(120) | Email (unique) |
| password_hash | String(255) | Password hash (PBKDF2 + SHA-256) |
| avatar_url | String(255) | Path to avatar (nullable) |

### Invitation
| Field | Type | Description |
|-------|------|-------------|
| id | Integer (PK) | Unique identifier |
| sender_id | FK → User | Who sent the invite |
| receiver_id | FK → User | Who received it |
| status | String(20) | `pending` / `accepted` / `rejected` |
| timestamp | DateTime | Creation time |

### Chat
| Field | Type | Description |
|-------|------|-------------|
| id | Integer (PK) | Unique identifier |
| user1_id | FK → User | First participant |
| user2_id | FK → User | Second participant |
| is_active | Boolean | Is the chat currently active |

### Message
| Field | Type | Description |
|-------|------|-------------|
| id | Integer (PK) | Unique identifier |
| chat_id | FK → Chat | Chat reference |
| sender_id | FK → User | Sender |
| content | Text | **Encrypted** content (base64) |
| message_type | String(10) | `text` or `audio` |
| timestamp | DateTime | Coarse time (±5 mins) |

> ⚠️ **Important:** The `content` field contains a string in the format `salt:iv:ciphertext` (base64). It can only be decrypted using the secret key entered by the users. The exact sending time is encrypted inside the `content`.

---

## 🌐 API Routes

### Pages
| Method | URL | Description |
|--------|-----|-------------|
| GET | `/` | Landing page |
| GET/POST | `/auth` | Login / Registration |
| GET | `/home` | Dashboard (chats, invites, search) |
| GET | `/chat/<id>` | Chat page |
| GET | `/profile` | User profile |
| GET | `/logout` | Logout |
| GET | `/sw.js` | Service Worker |

### API (JSON)
| Method | URL | Description |
|--------|-----|-------------|
| GET | `/search_users?q=` | Search for users |
| POST | `/send_invitation` | Send an invite |
| POST | `/accept_invitation/<id>` | Accept an invite |
| POST | `/reject_invitation/<id>` | Reject an invite |
| POST | `/send_message` | Send an encrypted message |
| POST | `/delete_message/<id>` | Delete a message (ephemeral) |
| GET | `/get_messages/<chat_id>` | Fetch new messages |
| POST | `/delete_chat/<id>` | Delete a chat |
| POST | `/update_avatar` | Upload an avatar |
| POST | `/change_password` | Change password |
| POST | `/delete_account` | Delete account |

### Socket.IO Events
| Event | Direction | Description |
|-------|-----------|-------------|
| `join_user_room` | Client → Server | Join personal room |
| `join_chat_room` | Client → Server | Join chat room |
| `leave_chat_room` | Client → Server | Leave chat room |
| `new_message` | Server → Client | New message broadcast |
| `typing` | Bidirectional | Peer started typing |
| `stop_typing` | Bidirectional | Peer stopped typing |

---

## 🚀 Installation & Setup

### Prerequisites
- Python 3.10+
- PostgreSQL 14+
- pip

### 1. Clone & Install Dependencies

```bash
cd SecurChat/app
python -m venv venv

# Windows
venv\Scripts\activate

# Linux / macOS
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Set Up Environment Variables

Create a `.env` file in the `app/` folder:

```env
# Flask
SECRET_KEY=your_secret_key_here
FLASK_DEBUG=False

# PostgreSQL
DATABASE_URI=postgresql://user:password@localhost:5432/dbname

# CORS (for local development)
CORS_ORIGIN=http://127.0.0.1:8000

# Security (Set to True for production)
COOKIE_SECURE=False
FORCE_HTTPS=False
```

Generate a `SECRET_KEY`:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### 3. Create the Database

```bash
# In PostgreSQL:
CREATE DATABASE dbname;
```

Tables will be created automatically on the first run (`db.create_all()`).

### 4. Run

```bash
cd app
python app.py
```

The application will be available at: **http://127.0.0.1:8000**

### For Production
1. Change `CORS_ORIGIN` in `.env` to your domain (e.g., `https://example.com`).
2. Set `SESSION_COOKIE_SECURE = True` in `app.py`.
3. Set `session_cookie_secure=True` in Talisman.
4. Set `force_https=True` in Talisman.
5. Change `connect-src` to `wss://` in the CSP.
6. Change `secure: false` to `secure: true` in the Socket.IO client (`scripts.js`).
7. Use Nginx/Apache as a reverse proxy with SSL (Let's Encrypt).

---

## ⚙ Configuration

### Key Parameters (in code)
| Parameter | File | Value | Description |
|-----------|------|-------|-------------|
| `EPHEMERAL_TIMEOUT` | scripts.js | 30000 ms | Lifespan of an ephemeral message |
| `INACTIVITY_TIMEOUT` | scripts.js | 180000 ms | Idle timeout (3 mins) |
| `PAD_SIZE` | scripts.js | 4096 bytes | Message padding size |
| `PBKDF2 iterations` | scripts.js | 600000 | Key derivation iterations |
| `coarse_timestamp` | app.py | 5 mins | Timestamp rounding interval |
| `MAX_CONTENT_LENGTH` | app.py | 2 MB | Max file upload size |
| `Rate Limits` | app.py | 200/day, 50/hr | Global request limits |

---

## 📖 Theory: Automatic Server Self-Defense Upon Compromise

> This section is purely educational. The mechanisms described here are used in cybersecurity and DevOps to protect highly confidential systems.

### The Problem

In an E2EE model, previously sent messages are cryptographically protected. However, if an attacker (or intelligence agencies) seizes control of the server, they could:
1. **Spoof JavaScript code** — inject a "backdoor" that intercepts the user's encryption key on their next visit and sends it to the attacker.
2. **Collect Metadata** — track who is talking to whom, when, and how often (even without decrypting the content).
3. **Intercept Future Keys** — new users, or users logging in from new devices, will receive the "poisoned" code.

The goal: ensure the server **automatically detects an intrusion** and self-destructs or locks down before the attacker can cause harm.

---

### Method 1: Dead Man's Switch

#### Principle
The server expects a regular "ping of life" from the administrator. If the ping is not received on time (the admin is arrested, lost access, or the server is isolated), a self-destruct protocol is initiated.

#### Implementation

```
┌──────────────────────────────────────────┐
│             Administrator                 │
│                                          │
│  Every 12 hours sends:                   │
│  POST /deadman/ping                      │
│  Authorization: HMAC-SHA256(timestamp,   │
│                              secret_key) │
└─────────────────┬────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────┐
│  Server: deadman_watchdog.py             │
│                                          │
│  1. Ping received → reset timer          │
│  2. Timer expires (12h + 1h buffer) →    │
│     ├── DROP ALL TABLES (PostgreSQL)     │
│     ├── shred -vfz -n 5 /app/.env        │
│     ├── shred -vfz -n 5 /app/app.py      │
│     ├── systemctl stop nginx             │
│     └── shutdown -h now                  │
│                                          │
│  Runs as an independent systemd service  │
│  (independent of Flask)                  │
└──────────────────────────────────────────┘
```

#### Pseudo-code (Python)

```python
# deadman_watchdog.py — standalone daemon
import time, os, subprocess, hmac, hashlib
from datetime import datetime, timedelta

DEADLINE_HOURS = 13  # 12 hours + 1 hour buffer
LAST_PING_FILE = "/var/deadman/.last_ping"
DEADMAN_SECRET = os.environ.get("DEADMAN_SECRET")

def verify_ping(timestamp, signature):
    """Verifies the cryptographic signature of the ping."""
    expected = hmac.new(
        DEADMAN_SECRET.encode(), timestamp.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

def self_destruct():
    """Complete data wipe."""
    # 1. Drop all tables in PostgreSQL
    subprocess.run(["psql", "-c", "DROP SCHEMA public CASCADE;"])
    # 2. Securely overwrite critical files multiple times
    for f in ["/app/.env", "/app/app.py", "/app/models.py"]:
        subprocess.run(["shred", "-vfz", "-n", "5", f])
    # 3. Stop web server
    subprocess.run(["systemctl", "stop", "nginx"])
    subprocess.run(["systemctl", "stop", "securchat"])
    # 4. Power off machine
    subprocess.run(["shutdown", "-h", "now"])

def main_loop():
    while True:
        # Check when the last ping occurred
        if os.path.exists(LAST_PING_FILE):
            last_ping = datetime.fromtimestamp(
                os.path.getmtime(LAST_PING_FILE)
            )
        else:
            last_ping = datetime.min

        if datetime.now() - last_ping > timedelta(hours=DEADLINE_HOURS):
            self_destruct()
            break

        time.sleep(60)  # Check every minute

if __name__ == "__main__":
    main_loop()
```

#### False Positive Prevention
- Set a buffer (1–2 hours) beyond the primary period.
- Use multiple ping channels (HTTP, SMS API, Telegram Bot).
- Send a warning notification to the administrator before destruction (optional).

---

### Method 2: Honeytokens (Trap Files)

#### Principle
"Bait" files are placed on the server with enticing names that are never read during normal operation. If an attacker accesses such a file (during manual reconnaissance or automated scraping), an alarm is triggered.

#### Implementation

```
┌────────────────────────────────────────────────┐
│  Server File System                             │
│                                                │
│  /app/                                         │
│  ├── app.py                                    │
│  ├── .env                                      │
│  ├── admin_backup_keys.txt   ◄── TRAP 🪤        │
│  ├── database_dump.sql       ◄── TRAP 🪤        │
│  └── .ssh/id_rsa             ◄── TRAP 🪤        │
│                                                │
│  Monitoring: inotifywait / auditd              │
│  On read of any trap file:                     │
│  ──► alert + self_destruct()                   │
└────────────────────────────────────────────────┘
```

#### Monitoring Command (Linux)

```bash
# honeytrap_monitor.sh
#!/bin/bash
TRAP_FILES=(
  "/app/admin_backup_keys.txt"
  "/app/database_dump.sql"
  "/app/.ssh/id_rsa"
)

for file in "${TRAP_FILES[@]}"; do
  # Create a bait file with plausible fake data
  echo "FAKE_DATA_$(openssl rand -hex 32)" > "$file"
done

# Monitor file access via inotifywait
inotifywait -m -e access "${TRAP_FILES[@]}" | while read -r line; do
  echo "[ALERT] Honeytoken accessed: $line"
  # Trigger self-destruct
  /app/self_destruct.sh
done
```

#### Linux auditd Variant

```bash
# Set up audit rules for trap files
auditctl -w /app/admin_backup_keys.txt -p r -k honeytoken
auditctl -w /app/database_dump.sql -p r -k honeytoken

# auditd rules can trigger a script upon an event
```

---

### Method 3: File Integrity Monitoring (FIM)

#### Principle
A background process regularly calculates the hashes of all critical project files. If even one file is modified (attacker tampered with the code) and the admin did not perform an update — the server locks down.

#### Implementation

```python
# integrity_monitor.py — runs as a standalone process
import hashlib, os, time, json, subprocess

WATCHED_FILES = [
    "/app/app.py",
    "/app/models.py",
    "/app/static/scripts/scripts.js",
    "/app/static/sw.js",
    "/app/templates/base.html",
    "/app/templates/chat.html",
]

HASHES_FILE = "/var/integrity/.file_hashes.json"
CHECK_INTERVAL = 10  # seconds

def compute_hash(filepath):
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            sha256.update(chunk)
    return sha256.hexdigest()

def save_baseline():
    """Save baseline hashes (upon deployment)."""
    hashes = {}
    for f in WATCHED_FILES:
        if os.path.exists(f):
            hashes[f] = compute_hash(f)
    with open(HASHES_FILE, 'w') as fp:
        json.dump(hashes, fp)

def check_integrity():
    """Check current hashes against the baseline."""
    with open(HASHES_FILE) as fp:
        baseline = json.load(fp)

    for filepath, expected_hash in baseline.items():
        if not os.path.exists(filepath):
            return False, f"File deleted: {filepath}"
        current_hash = compute_hash(filepath)
        if current_hash != expected_hash:
            return False, f"File modified: {filepath}"
    return True, "OK"

def main_loop():
    while True:
        ok, message = check_integrity()
        if not ok:
            # ALERT: files have been tampered with
            # 1. Stop the web server
            subprocess.run(["systemctl", "stop", "securchat"])
            # 2. Notify the administrator
            # send_telegram_alert(message)
            # 3. Optionally: wipe data
            break
        time.sleep(CHECK_INTERVAL)
```

#### Important Nuances
- Baseline hashes must be stored on a read-only partition or a separate server.
- The monitoring script itself must be protected against spoofing.
- During a legitimate code update, the baseline must be updated (via a secure authenticated procedure).

---

### Method 4: Duress Password

#### Principle
The administrator has two passwords to log into the control panel:
- **Real Password** — standard login.
- **Duress Password** — seemingly functions normally, but silently triggers a self-destruct in the background.

This is used in scenarios where the administrator is physically coerced into logging into the system.

#### Logic

```
Password Entry ──► "correcthorse"  ──► Normal Login ✅
               │
               └► "correcthorse!" ──► Login + in background:
                                      ├── DELETE FROM message
                                      ├── Alert other admins
                                      └── After 5 mins: DROP ALL TABLES
```

#### Example (Flask)

```python
DURESS_PASSWORD_HASH = generate_password_hash("duress_password")

@app.route('/admin_login', methods=['POST'])
def admin_login():
    password = request.form['password']

    # Check for duress password
    if check_password_hash(DURESS_PASSWORD_HASH, password):
        # Outwardly normal login
        login_user(admin_user)
        # Background silent wipe
        threading.Thread(target=silent_wipe, daemon=True).start()
        return redirect('/admin')

    # Normal login
    if check_password_hash(REAL_PASSWORD_HASH, password):
        login_user(admin_user)
        return redirect('/admin')

    return "Invalid password", 401

def silent_wipe():
    """Silent data wipe with a delay."""
    time.sleep(300)  # 5 minutes — to avoid raising suspicion
    db.session.execute(text("DELETE FROM message"))
    db.session.execute(text("DELETE FROM chat"))
    db.session.commit()
    # After 10 minutes — complete destruction
    time.sleep(300)
    db.session.execute(text("DROP SCHEMA public CASCADE"))
    db.session.commit()
    os._exit(0)
```

---

### Method 5: Warrant Canary

#### Principle
This is a legal mechanism rather than an automatic one. The administrator regularly publishes a public, cryptographically signed statement:

> "As of March 8, 2026, we have not received any requests from government agencies to disclose user data. Our server has not been compromised."

If the statement disappears or stops being updated, users understand that something has happened.

#### How it works

```
┌─────────────────────────────────────────────────┐
│  Once a week, the admin publishes on the site:  │
│                                                 │
│  -----BEGIN PGP SIGNED MESSAGE-----             │
│  Date: 2026-03-08                               │
│  Serial Number: #0042                           │
│  Statement: SecurChat has not received          │
│  requests from intelligence agencies. All       │
│  systems are operating normally.                │
│  -----END PGP SIGNED MESSAGE-----               │
│                                                 │
│  If signature is missing → server compromised   │
│  If date is outdated → admin is unavailable     │
└─────────────────────────────────────────────────┘
```

#### Why it works
In many jurisdictions, intelligence agencies can issue a "gag order" forbidding the admin from *speaking* about a request. However, they cannot compel the admin to *continue publishing a false statement*. The absence of a new statement serves as a passive signal that does not violate the gag order.

---

### Method 6: Disk Encryption with RAM Key (LUKS + tmpfs)

#### Principle
The entire server disk is encrypted (LUKS). The decryption key is stored exclusively in Random Access Memory (RAM). If the power is cut or the server reboots, the key vanishes, rendering the disk unreadable.

#### Scenario
1. Intelligence agencies arrive at the data center.
2. They pull the server's power plug (standard seizure procedure).
3. The RAM loses data in ~2-5 seconds.
4. The encryption key is lost forever.
5. The disk becomes a meaningless set of random bytes.

```bash
# LUKS setup + RAM Key
cryptsetup luksFormat /dev/sda2
cryptsetup luksOpen /dev/sda2 encrypted_data

# Key is stored only in tmpfs (RAM)
mkdir -p /run/keys
mount -t tmpfs tmpfs /run/keys -o size=1M,mode=700
dd if=/dev/urandom of=/run/keys/disk.key bs=64 count=1
cryptsetup luksAddKey /dev/sda2 /run/keys/disk.key
```

---

### Combined Strategy (Recommendation)

For maximum protection, it is recommended to combine several methods:

```
┌─────────────────────────────────────────────────────┐
│                 DEFENSE IN DEPTH                     │
│                                                     │
│  Layer 1: Warrant Canary                            │
│  └── Weekly published signed statement              │
│                                                     │
│  Layer 2: Dead Man's Switch                         │
│  └── Ping every 12 hours, otherwise destruction     │
│                                                     │
│  Layer 3: File Integrity Monitoring                 │
│  └── Hash checking every 10 seconds                 │
│                                                     │
│  Layer 4: Honeytokens                               │
│  └── Trap files with access monitoring              │
│                                                     │
│  Layer 5: LUKS + RAM Key                            │
│  └── Disk encrypted, key resides only in RAM        │
│                                                     │
│  Layer 6: Duress Password                           │
│  └── Panic password for physical coercion           │
│                                                     │
│  Result: Even in the event of physical server       │
│  seizure, data is destroyed or rendered unreadable. │
└─────────────────────────────────────────────────────┘
```

---

## 📝 License

This project was created for educational purposes to study the principles of cryptography, web application security, and Zero-Knowledge system architecture.

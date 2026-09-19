# TakeOFF — Driver Onboarding (Track A)

A complete driver onboarding system: sign-up, phone OTP verification, personal/identity/vehicle
details, document uploads, application submission, a driver status dashboard, and an
admin/reviewer dashboard with approve/reject — backed by MySQL.

**Stack:** Node.js + Express (API) · MySQL · vanilla HTML/CSS/JS (mobile-responsive, no build step)

---

## 1. Project layout

```
takeoff-onboarding/
├── schema.sql                 # MySQL schema (run once)
├── .env.example                # copy to .env and fill in
├── package.json
├── src/
│   ├── server.js                # app entry point
│   ├── config/db.js             # MySQL pool + connection check
│   ├── config/seed.js           # creates the first admin account
│   ├── middleware/auth.js       # JWT auth + role guard
│   ├── middleware/upload.js     # multer upload config (type/size limits)
│   ├── utils/otp.js             # OTP: test mode + Twilio Verify
│   └── routes/
│       ├── auth.js              # signup, login, OTP request/verify
│       ├── onboarding.js        # personal/identity/vehicle/documents/submit (driver)
│       └── admin.js             # list/detail/approve/reject/file download (admin)
├── public/                      # static frontend
│   ├── index.html               # sign in / sign up
│   ├── otp.html                 # phone OTP verification
│   ├── onboarding.html          # 5-step application form
│   ├── dashboard.html           # driver status dashboard
│   ├── admin.html                # reviewer dashboard
│   ├── css/style.css
│   └── js/api.js                # shared fetch/session helper
└── uploads/                     # uploaded documents (created automatically)
```

---

## 2. Local setup

### Prerequisites
- Node.js 18+
- MySQL 8+ (or MariaDB 10.6+)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Create the database and tables
mysql -u root -p < schema.sql

# 3. Create an app-specific DB user (recommended over using root)
mysql -u root -p -e "
  CREATE USER 'takeoff_user'@'localhost' IDENTIFIED BY 'change_me';
  GRANT ALL PRIVILEGES ON takeoff_onboarding.* TO 'takeoff_user'@'localhost';
  FLUSH PRIVILEGES;"

# 4. Configure environment
cp .env.example .env
# edit .env: set DB_USER/DB_PASSWORD, JWT_SECRET (openssl rand -hex 32), OTP_MODE, etc.

# 5. Create the first admin/reviewer account
npm run seed
# prints the admin email/password from ADMIN_EMAIL / ADMIN_PASSWORD in .env

# 6. Start the app
npm start          # production
npm run dev         # auto-restart on changes (nodemon)
```

Open **http://localhost:4000**. Drivers sign up from the home page; admins sign in with the
seeded account and land on `/admin.html` automatically (role is read from the JWT).

---

## 3. Test OTP mode (no SMS provider needed)

By default `.env` has:
```
OTP_MODE=test
OTP_TEST_CODE=123456
```

In test mode:
- No SMS is sent.
- Requesting a code returns it directly in the API response (`testCode`) **and** logs it to the
  server console, e.g. `[OTP:test] phone=+14155550123 purpose=signup code=123456`.
- The frontend shows the code on-screen in a blue banner on the OTP page, so a reviewer can
  complete the whole flow without a real phone.
- If `OTP_TEST_CODE` is left blank, a random 6-digit code is generated per request instead of a
  fixed one (still returned/logged the same way).

This mode is intended for local development and demos only — never enable it in production.

---

## 4. Real SMS via Twilio Verify

1. Create a [Twilio](https://www.twilio.com/) account and a **Verify Service** (Twilio Console →
   Verify → Services). Copy the Service SID (`VAxxxxxxxx...`).
2. Set in `.env`:
   ```
   OTP_MODE=twilio
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
3. Restart the app. `POST /api/auth/otp/request` now calls
   `client.verify.v2.services(...).verifications.create({ to, channel: 'sms' })`, and
   `POST /api/auth/otp/verify` calls `verificationChecks.create({ to, code })`. Twilio owns the
   code lifecycle (expiry, attempt limits); the app just relays the result.
4. Trial Twilio accounts can only text phone numbers you've verified in the Twilio console —
   verify your own test number there before demoing.

No frontend changes are needed to switch modes — `otp.html` simply stops showing the test-code
banner because the API response no longer includes `testCode`.

---

## 5. Deployment instructions

The app is a single Node process serving both the API and the static frontend, so most hosts work.

### Option A — a VM / VPS (Ubuntu example)
```bash
sudo apt update && sudo apt install -y nodejs npm mysql-server
git clone <your-repo> && cd takeoff-onboarding
npm install --omit=dev
mysql -u root -p < schema.sql
cp .env.example .env   # edit with production values
npm run seed
# Run under a process manager so it restarts on crash/reboot:
sudo npm install -g pm2
pm2 start src/server.js --name takeoff-onboarding
pm2 save && pm2 startup
```
Put Nginx (or Caddy) in front for TLS termination and to proxy port 443 → `PORT` (4000 by
default). Example Nginx snippet:
```nginx
server {
  listen 443 ssl;
  server_name driver.example.com;
  ssl_certificate     /etc/letsencrypt/live/driver.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/driver.example.com/privkey.pem;
  client_max_body_size 10m;   # allow document uploads
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Option B — managed platform (Render, Railway, Fly.io, Heroku-style)
1. Push this repo to GitHub.
2. Create a MySQL add-on/instance on the platform (or use PlanetScale/Amazon RDS).
3. Set the same environment variables from `.env.example` in the platform's dashboard.
4. Set the start command to `npm start` and the build command to `npm install`.
5. Run `schema.sql` against the managed database once (most platforms give you a connection
   string you can pipe into `mysql`), then run `npm run seed` as a one-off job/console command.
6. **Persistent storage for uploads:** ephemeral filesystems (common on PaaS) will lose uploaded
   files on redeploy. For real deployments, point `UPLOAD_DIR` at a mounted volume, or swap the
   `multer.diskStorage` in `src/middleware/upload.js` for an S3-compatible storage engine
   (`multer-s3`) — the rest of the app only depends on `stored_path` being resolvable.

### Environment checklist for any deployment
- [ ] `JWT_SECRET` is a long random value, different from the example.
- [ ] `OTP_MODE=twilio` with real Twilio credentials (test mode must never run in production).
- [ ] `NODE_ENV=production`.
- [ ] Database user is scoped to just this database (not root).
- [ ] HTTPS is terminated in front of the app (cookies aren't used, but tokens and documents
      should never travel over plain HTTP).
- [ ] `uploads/` is on persistent, access-controlled storage.

---

## 6. Assessment / demo checklist

A suggested run-through covering every required capability:

1. **Sign up** a new driver on `/index.html` (Sign up tab) with a phone in E.164 format
   (e.g. `+14155550123`).
2. **Phone OTP** — land on `/otp.html`; the test-mode banner shows the code (also printed in the
   server console). Enter it to verify.
3. **Personal & contact details** — step 1 of `/onboarding.html`.
4. **Identity verification** — step 2: ID type + number.
5. **Vehicle details** — step 3: make/model/year/plate.
6. **Document uploads** — step 4: upload an identity document and a vehicle document (JPG/PNG/PDF).
7. **Review & submit** — step 5 shows a summary; submitting moves the application to `submitted`
   and locks it from further edits.
8. **Driver dashboard** (`/dashboard.html`) — shows status = Submitted.
9. **Sign out**, then **sign in as the admin** (seeded via `npm run seed`) → lands on
   `/admin.html`.
10. **Reviewer dashboard** — filter by "Submitted", open the driver's application, view uploaded
    documents inline, optionally "Mark under review".
11. **Approve or reject** with optional notes.
12. **Sign back in as the driver** → dashboard now shows Approved/Rejected with the reviewer's
    notes if rejected.
13. **Responsive check** — resize the browser to ~375px wide (or open on a phone); forms,
    tables, and the step indicator all reflow correctly.
14. **Security spot-checks** (see below) — try a driver token against an admin endpoint (403),
    try no token at all (401), try re-submitting an already-submitted application (409).

---

## 7. Basic security protections implemented

- **Password storage:** bcrypt with cost factor 12; passwords never logged or returned by the API.
- **Authentication:** stateless JWTs (`JWT_SECRET`, configurable expiry), verified on every
  protected route via `requireAuth` middleware.
- **Authorization:** `requireRole('driver'|'admin')` middleware enforces role separation — a
  driver token cannot reach `/api/admin/*`, an admin cannot submit onboarding steps.
- **OTP abuse controls:** per-phone cooldown between requests, attempt counter with a max, code
  expiry, and single-use consumption. Route-level rate limiting on `/otp/*` and `/login`.
- **Login brute-force protection:** failed login attempts are counted; the account is locked for
  15 minutes after 5 consecutive failures. Login errors are generic ("Invalid email or password")
  to avoid confirming whether an email exists.
- **SQL injection:** every query uses parameterized placeholders via `mysql2` — no string
  concatenation of user input into SQL.
- **File upload hardening:** MIME allow-list (JPG/PNG/WEBP/PDF only), 5MB size cap, filenames
  are randomly generated server-side (the client-supplied name is never used on disk), and
  document downloads are streamed only to authenticated admins with a path-traversal guard.
- **HTTP hardening:** `helmet` sets a restrictive Content-Security-Policy and standard security
  headers; CORS is scoped; JSON body size is capped at 1MB to limit payload-based abuse.
- **Input validation:** `express-validator` validates and normalizes every request body (email
  format, E.164 phone format, enum fields, string lengths) before it reaches the database.
- **State machine guards:** once an application is `submitted`, further edits to
  personal/identity/vehicle/documents are rejected (409) until an admin decision resets the flow;
  decisions can only be made on `submitted`/`under_review` applications, preventing double
  approval/rejection.
- **Audit trail:** `audit_log` records submissions and admin decisions (who, what, when, notes)
  for accountability.

### Known limitations (acceptable for an assessment build, call out for production)
- JWTs are stored in `localStorage` on the client for simplicity; a production app handling
  sensitive documents should consider httpOnly cookies + CSRF protection instead.
- No email verification step (only phone OTP) — acceptable per the brief's flow but worth adding
  before real-world use.
- No automated test suite is included; routes were verified manually end-to-end (signup → OTP →
  onboarding → submit → admin approve/reject) plus role-based access checks.
- File storage is local disk; see the deployment section for swapping to S3-compatible storage.

---

## 8. API reference (quick summary)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | none | Create a driver account |
| POST | `/api/auth/otp/request` | none | Send/generate an OTP |
| POST | `/api/auth/otp/verify` | none | Verify OTP, returns JWT |
| POST | `/api/auth/login` | none | Email+password login |
| PUT  | `/api/onboarding/personal` | driver | Save personal/contact details |
| PUT  | `/api/onboarding/identity` | driver | Save identity verification details |
| PUT  | `/api/onboarding/vehicle` | driver | Save vehicle details |
| POST | `/api/onboarding/documents` | driver | Upload one document (multipart) |
| GET  | `/api/onboarding/me` | driver | Fetch everything + application status |
| POST | `/api/onboarding/submit` | driver | Submit the completed application |
| GET  | `/api/admin/applications` | admin | List applications (optional `?status=`) |
| GET  | `/api/admin/applications/:userId` | admin | Full application detail |
| GET  | `/api/admin/documents/:id/file` | admin | Stream a document file |
| POST | `/api/admin/applications/:userId/mark-review` | admin | submitted → under_review |
| POST | `/api/admin/applications/:userId/decision` | admin | Approve or reject |

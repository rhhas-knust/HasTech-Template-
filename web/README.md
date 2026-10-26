# HASTECH School Management System — Web version

One shared web app for every school, hosted on Vercel. Each school's data lives in **its own Google Sheet**, which the school can open in Google Sheets at any time. Staff sign in with their own Gmail / Google accounts.

```
School staff ──► https://your-app.vercel.app/bright-future ──► Vercel functions ──► Google Sheets API ──► Bright Future's sheet
                 https://your-app.vercel.app/hope-academy  ──►        (same app)        ──►               Hope Academy's sheet
```

- **Registry sheet** (owned by HASTECH): lists every school: link name, display name, and sheet ID.
- **School sheet** (one per school, can be owned by the school): the same tabs as the Apps Script version (STUDENTS, CLASSES, PAYMENTS, ...). A school's data never touches another school's sheet.
- **Service account**: a robot Google account. Each sheet is shared with it as Editor, which is how the app reads and writes. Staff never see it.
- **Staff access**: a person can open a school only if their Google account email is listed as ACTIVE in that school's **ADMINS** tab (managed from **Settings → Staff Access**). Emails in `HASTECH_SUPER_ADMINS` can open every school.

Each school can customise, from **Settings**:
- Name, motto, contact details, logo, and the main and accent colours.
- Currency, timezone, academic year, and the Student ID prefix.
- Which features are switched on (Attendance, Payments, Announcements, Reports).

Roles:
- **Staff** handle students, attendance, payments and announcements.
- **Admin** can also manage settings, classes and staff.
- **Super Admin** has full control.

---

## One-time setup (HASTECH)

You need: a Google account for HASTECH, a GitHub account with this repository, and a free Vercel account.

### 1. Google Cloud project
1. Go to <https://console.cloud.google.com/>, then **Select a project → New project**. Name it `hastech-school`.
2. Go to **APIs & Services → Library**, search for **Google Sheets API**, and click **Enable**.

### 2. Service account (the robot that reads/writes sheets)
1. Go to **APIs & Services → Credentials → Create credentials → Service account**. Name it `school-app`, then **Done**.
2. Open the new service account, go to **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
   Keep it secret: anyone with this file can edit every school sheet shared with it.
3. Note its email, e.g. `school-app@hastech-school.iam.gserviceaccount.com`. You'll share sheets with this address.

### 3. "Sign in with Google" client
1. Go to **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in the app name (e.g. "HASTECH School") and support email.
   - Add no extra scopes. Only the basic email/profile sign-in is used, which doesn't need Google verification.
   - Under **Publishing status**, click **Publish app** so any Gmail account can sign in.
2. Go to **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Under **Authorised JavaScript origins**, add your site's address (you'll get it in step 5, e.g. `https://hastech-school.vercel.app`), any custom domain, and `http://localhost:3000` for local testing. You can come back and add these later.
   - Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

### 4. Registry sheet
1. Create a new Google Sheet named **HASTECH School Registry**.
2. Click **Share**, add the service account email as **Editor**, and untick "Notify people".
3. Copy the sheet ID from its address: `https://docs.google.com/spreadsheets/d/`**`THIS-PART`**`/edit`.
   The app creates the `SCHOOLS` tab itself the first time you add a school.

### 5. Deploy to Vercel
1. Go to <https://vercel.com/new> and import this GitHub repository.
2. Set **Root Directory** to `web`. Framework preset: **Other**. Leave the build and output settings empty.
3. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | the whole contents of the JSON key file (paste as-is) |
   | `GOOGLE_CLIENT_ID` | the OAuth Client ID from step 3 |
   | `SESSION_SECRET` | a long random string, e.g. from <https://www.random.org/strings/> (at least 32 characters) |
   | `REGISTRY_SPREADSHEET_ID` | the registry sheet ID from step 4 |
   | `HASTECH_SUPER_ADMINS` | your Gmail address(es), comma-separated |
   | `RESEND_API_KEY`, `EMAIL_FROM` | optional, for guardian registration emails via <https://resend.com> |

4. Click **Deploy**. Then add the site address to the OAuth client's **Authorised JavaScript origins** (step 3).

Updates: push to the branch Vercel is connected to and it redeploys automatically. Unlike Apps Script, there's no "New version" step.

---

## Adding a school

1. **The school** (or you on their behalf) creates a blank Google Sheet, e.g. "Bright Future Academy – School Data", in **their own** Google Drive. This way the school owns its data.
2. Share that sheet with the service account email as **Editor**.
3. On your computer (Node.js 20+ installed), in the `web` folder:
   ```bash
   npm install
   cp .env.example .env      # then fill in the same values as on Vercel, with STORE=sheets
   node scripts/setup-school.js --slug bright-future --name "Bright Future Academy" \
        --sheet "https://docs.google.com/spreadsheets/d/<id>/edit" --admin headteacher@gmail.com
   ```
   Add `--demo` to load sample classes, students and announcements.

   The script creates the tabs, default settings, and the head teacher as Super Admin, then lists the school in the registry.
4. Send the head teacher the link `https://<your-site>/bright-future`. They sign in with the Gmail you gave as `--admin` and add their staff under **Settings → Staff Access**.

To suspend a school, set its `STATUS` to `INACTIVE` in the registry sheet. The change takes effect within a minute.

**Tips for schools editing their sheet directly:**
- Viewing, sorting, filtering, and fixing a typo are all fine.
- Don't rename tabs or header names.
- Don't delete rows from STUDENTS or PAYMENTS. Set a student's STATUS instead, because IDs are numbered from row positions.

---

## Local development

```bash
cd web
npm install
npm run dev          # http://localhost:3000/demo
```

With no `.env`, it runs on **in-memory demo data**: no Google setup needed, and a "test sign-in" box appears instead of the Google button. Sign in as `admin@example.com`. Data is kept in `web/.data/dev-db.json`; delete that file to start fresh.

Tests:
```bash
npm test             # unit tests, no extra installs
npm run test:e2e     # browser tests; needs: npm i -D playwright && npx playwright install chromium
```

---

## How it's built

| Path | What it does |
|---|---|
| `public/` | The app's pages: `index.html`, `styles.css`, `app.js` (ported from the Apps Script HTML) |
| `api/session.js` | Sign in with Google / sign out / who am I |
| `api/school.js` | Public branding for the login screen |
| `api/rpc.js` | Every app action. Allow-listed functions, each with a minimum role and feature |
| `api/pdf.js` | Student profile, receipt and report PDFs, generated on the fly and downloaded |
| `lib/domain/` | Business rules (students, attendance, payments, announcements, reports, settings, staff, setup) |
| `lib/context.js` | Reads all of a school's tabs in one API call, then batches the writes |
| `lib/store/` | `sheets.js` (Google Sheets API) and `memory.js` (local/tests), with the same interface |
| `lib/auth.js` | Google ID-token verification, signed session cookie, membership and role checks |

Security:
- Sign-in tokens are verified against Google's keys and this app's Client ID.
- Sessions are HMAC-signed, HttpOnly cookies.
- Every request re-checks the user's school membership, role and enabled features on the server.
- Write requests require a custom header, which blocks cross-site forgery.
- All input is validated on the server, and all output is HTML-escaped.

---

## Limits to know about

- **Google Sheets API quota.** By default Google allows roughly 60 read and 60 write requests per minute *per service account*, shared by all schools.
  - Each screen load is 1–2 reads; saving a student is about 4 writes.
  - That's comfortable for a few schools with a handful of staff each. The app retries automatically when it hits the limit and tells the user to wait a moment.
  - Before onboarding many schools, request a higher quota under **APIs & Services → Google Sheets API → Quotas**. Or move to a real database that syncs a copy to Sheets; the `lib/store` interface is where that swap would go.
- **Concurrency.**
  - Student and payment IDs are race-safe because they come from the row Google wrote to.
  - Other edits are last-write-wins, which is fine for a school office.
- **PDFs** are generated on demand and downloaded. They are not stored in Drive, because a service account has no Drive storage of its own. Each generation is still recorded in the DOCUMENTS tab.
- **Emails** go out only if Resend is configured. Gmail-as-the-school sending isn't included.
- Data from the old Apps Script version isn't migrated automatically. The tab layout is the same, so rows can be copied across. Dates typed into cells by hand are understood.

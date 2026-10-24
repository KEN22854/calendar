# Booking Calendar — Online School

[Русский](README.md) | **English**

A web app for students of an online school to book lessons with a monthly pass
(4, 8 or 12 lessons per month), with an admin panel, a full booking history and a flexible schedule.
The interface is in Russian, styled in pink.

**Stack:** Node.js, Express, SQLite (better-sqlite3), JWT, plain HTML/CSS/JS with no build step.

## Features

- **Students** book one week ahead: Monday–Saturday, Sunday is always a day off.
- **Passes** of 4, 8 or 12 lessons per month are assigned by the administrator.
- **Admin panel:** monthly calendar, bookings list, students, passes, schedule.
- **History (audit):** every booking ever made — as a calendar and as a list, with CSV export.
- **Schedule:** the standard is every hour; time can be added or disabled for a single day.

## Getting started

Requires Node.js 18+.

```bash
npm install
cp .env.example .env
node server/index.js
```

Open http://localhost:3000. On Windows use `copy .env.example .env` instead of `cp`.
If PowerShell blocks `npm`, run the server directly: `node server/index.js`.

On first start the database and the administrator from `.env` are created.
**Change `ADMIN_PASSWORD` and `JWT_SECRET` before deploying.**

## Configuration (`.env`)

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `JWT_SECRET` | Secret for login tokens — a long random string | — |
| `JWT_EXPIRES_IN` | Login lifetime | `7d` |
| `DB_PATH` | Path to the SQLite database file | `./data/booking.db` |
| `SEED_ADMIN` | Create the administrator on start if none exists | `true` |
| `ADMIN_LOGIN`, `ADMIN_PASSWORD` | Administrator login and password | — |

To reset the existing administrator's password: `npm run seed` (uses the values from `.env`).

## Pages

| URL | For | Contents |
|---|---|---|
| `/register`, `/login` | everyone | Sign up and sign in |
| `/` | student | Weekly schedule and booking |
| `/my-bookings` | student | My bookings and cancellation |
| `/admin` | admin | Admin panel |

## Students

- Only one week is shown: **Monday–Saturday**. Sunday is always a day off.
- On Sunday the **next** week opens.
- Past days are inactive and cannot be booked.
- Booking requires an active pass, a date within the pass period and lessons left.
- Cancelling a booking returns the lesson to the pass.

## Passes

- Types: **4, 8 or 12 lessons per month**, assigned by the admin on the **Students** and **Passes** tabs.
- Valid for one month from the start date, inclusive (Oct 1 → Oct 31). The previous active pass is closed.
- The admin can edit the lesson count (total and used), the end date and whether the pass is active.

## Lesson times

- **Standard schedule** (the **Slots** tab) — whole hours only, applies to every day.
  Default: 09:00–20:00.
- **Single day** — the ⚙ button on a day in the admin calendar. Standard hours can be disabled
  for that day, and non-standard times (e.g. 14:30) can be added and removed. Other days are not affected.
- A time that has a booking cannot be disabled or removed — cancel the booking first.

## Admin: manual booking

The **Calendar** and **Bookings list** tabs have a **"+ Create booking"** button:
student, date (Sunday or a past date is allowed), time, Telegram and phone.
- If the student has an active pass with lessons left, a lesson is deducted (can be turned off).
- The "current week only" restriction does not apply to the admin.

## History (audit)

The **History (audit)** tab shows **all** bookings — scheduled, past and cancelled:
- two views: **Calendar** (exactly one month; click a day to see all its bookings) and **List** (paginated table);
- filters by student, status and dates, per-status counters, CSV export;
- the "History" button on the **Students** tab opens a single student's bookings.

### Archiving

- Every day at **00:01 (Moscow time)** past bookings are moved to the archive (`bookings_archive`):
  they leave the schedule but stay in the history forever. The same check runs on server start.
- Future bookings are not touched.
- Cancelled bookings are kept in the history too, marked with who cancelled them.

## API (summary)

All `/api/admin/*` requests require an administrator token (`Authorization: Bearer …`).

| Method and path | Description |
|---|---|
| `POST /api/register`, `POST /api/login` | Sign up and sign in |
| `GET /api/bookings?date=` / `POST /api/bookings` | Day schedule / student booking |
| `GET /api/my-bookings`, `DELETE /api/bookings/:id` | My bookings / cancel |
| `GET /api/my-subscription` | My pass |
| `GET/POST/PATCH/DELETE /api/admin/subscriptions` | Passes |
| `GET/POST/DELETE /api/admin/slots/day` | Times for a specific day |
| `GET /api/admin/history`, `GET /api/admin/history.csv` | History: `from`, `to`, `user`, `status=active\|done\|cancelled` |

## Project structure

```
client/          pages, styles and frontend scripts
server/
  index.js       server start and nightly archiving
  db.js          database schema and migrations
  archive.js     moving bookings into the history
  utils.js       dates, booking week, slots
  routes/        API: auth, bookings, passes, admin, slots
scripts/seed.js  create/reset the administrator
data/            SQLite database file (not stored in git)
```

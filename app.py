import json
import os
import sqlite3
import uuid
from datetime import date, datetime, timedelta

from flask import (
    Flask,
    abort,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH") or os.path.join(BASE_DIR, "whentomeet.db")

SLOT_OPTIONS = (15, 30, 60)
MAX_RANGE_DAYS = 60
MAX_NAME_LENGTH = 80
MAX_DESCRIPTION_LENGTH = 500

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    start_hour INTEGER NOT NULL,
    end_hour INTEGER NOT NULL,
    slot_minutes INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS responses (
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    slot INTEGER NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (0, 1, 2)),
    PRIMARY KEY (participant_id, day, slot)
);
"""

app = Flask(__name__)


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    try:
        con.executescript(SCHEMA)
        con.commit()
    finally:
        con.close()


init_db()


def parse_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def format_day(iso_day):
    d = date.fromisoformat(iso_day)
    return f"{WEEKDAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]}"


def event_days(ev):
    current = date.fromisoformat(ev["start_date"])
    end = date.fromisoformat(ev["end_date"])
    days = []
    while current <= end:
        days.append(current.isoformat())
        current += timedelta(days=1)
    return days


def slot_count(ev):
    return (ev["end_hour"] - ev["start_hour"]) * 60 // ev["slot_minutes"]


def slot_label(ev, index):
    minutes = ev["start_hour"] * 60 + index * ev["slot_minutes"]
    hours, mins = divmod(minutes, 60)
    return f"{hours:02d}:{mins:02d}"


def get_event(event_id):
    ev = get_db().execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if ev is None:
        abort(404)
    return ev


def event_public(ev):
    days = event_days(ev)
    slots = [
        {"index": i, "label": slot_label(ev, i)}
        for i in range(slot_count(ev))
    ]
    return {
        "id": ev["id"],
        "name": ev["name"],
        "description": ev["description"],
        "start_date": ev["start_date"],
        "end_date": ev["end_date"],
        "start_hour": ev["start_hour"],
        "end_hour": ev["end_hour"],
        "slot_minutes": ev["slot_minutes"],
        "days": [{"date": d, "label": format_day(d)} for d in days],
        "slots": slots,
    }


def json_for_script(data):
    return json.dumps(data).replace("<", "\\u003c")


def default_form():
    tomorrow = date.today() + timedelta(days=1)
    return {
        "name": "",
        "description": "",
        "start_date": tomorrow.isoformat(),
        "end_date": tomorrow.isoformat(),
        "start_hour": 9,
        "end_hour": 18,
        "slot_minutes": 30,
    }


def validate_event_form(form):
    if not form["name"]:
        return "Give the event a name."
    if len(form["name"]) > 120:
        return "The name cannot exceed 120 characters."
    if len(form["description"]) > MAX_DESCRIPTION_LENGTH:
        return f"The description cannot exceed {MAX_DESCRIPTION_LENGTH} characters."
    try:
        start = date.fromisoformat(form["start_date"])
        end = date.fromisoformat(form["end_date"])
    except ValueError:
        return "The dates are not valid."
    if end < start:
        return "The end date must be the same as or later than the start date."
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        return f"The date range cannot exceed {MAX_RANGE_DAYS} days."
    if not 0 <= form["start_hour"] <= 23:
        return "The start time is not valid."
    if not 1 <= form["end_hour"] <= 24 or form["end_hour"] <= form["start_hour"]:
        return "The end time must be later than the start time."
    if form["slot_minutes"] not in SLOT_OPTIONS:
        return "The slot duration is not valid."
    return None


def read_responses(ev, raw):
    valid_days = set(event_days(ev))
    total_slots = slot_count(ev)
    rows = []
    if not isinstance(raw, dict):
        return rows
    for day, slots in raw.items():
        if day not in valid_days or not isinstance(slots, dict):
            continue
        for slot_str, value in slots.items():
            try:
                slot = int(slot_str)
                value = int(value)
            except (TypeError, ValueError):
                continue
            if 0 <= slot < total_slots and value in (0, 1, 2):
                rows.append((day, slot, value))
    return rows


@app.route("/")
def index():
    return render_template(
        "index.html", form=default_form(), error=None, slot_options=SLOT_OPTIONS
    )


@app.post("/create")
def create_event():
    form = {
        "name": (request.form.get("name") or "").strip(),
        "description": (request.form.get("description") or "").strip(),
        "start_date": (request.form.get("start_date") or "").strip(),
        "end_date": (request.form.get("end_date") or "").strip(),
        "start_hour": parse_int(request.form.get("start_hour"), 9),
        "end_hour": parse_int(request.form.get("end_hour"), 18),
        "slot_minutes": parse_int(request.form.get("slot_minutes"), 30),
    }
    error = validate_event_form(form)
    if error:
        return (
            render_template(
                "index.html", form=form, error=error, slot_options=SLOT_OPTIONS
            ),
            400,
        )

    event_id = uuid.uuid4().hex[:12]
    db = get_db()
    db.execute(
        """
        INSERT INTO events
            (id, name, description, start_date, end_date,
             start_hour, end_hour, slot_minutes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            form["name"],
            form["description"],
            form["start_date"],
            form["end_date"],
            form["start_hour"],
            form["end_hour"],
            form["slot_minutes"],
            datetime.now().isoformat(timespec="seconds"),
        ),
    )
    db.commit()
    return redirect(url_for("event_page", event_id=event_id))


@app.get("/e/<event_id>")
def event_page(event_id):
    ev = get_event(event_id)
    return render_template(
        "event.html", event=ev, event_json=json_for_script(event_public(ev))
    )


@app.get("/e/<event_id>/results")
def results_page(event_id):
    ev = get_event(event_id)
    return render_template(
        "results.html", event=ev, event_json=json_for_script(event_public(ev))
    )


@app.get("/api/e/<event_id>/participant")
def get_participant(event_id):
    get_event(event_id)
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is missing"}), 400

    db = get_db()
    participant = db.execute(
        "SELECT id, name FROM participants WHERE event_id = ? AND name = ?",
        (event_id, name),
    ).fetchone()
    if participant is None:
        return jsonify({"found": False, "responses": {}})

    responses = {}
    for row in db.execute(
        "SELECT day, slot, value FROM responses WHERE participant_id = ?",
        (participant["id"],),
    ):
        responses.setdefault(row["day"], {})[str(row["slot"])] = row["value"]
    return jsonify({"found": True, "name": participant["name"], "responses": responses})


@app.post("/api/e/<event_id>/respond")
def save_response(event_id):
    ev = get_event(event_id)
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Enter your name to save."}), 400
    if len(name) > MAX_NAME_LENGTH:
        return jsonify({"error": "The name is too long."}), 400

    rows = read_responses(ev, data.get("responses"))

    db = get_db()
    db.execute(
        """
        INSERT INTO participants (event_id, name, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(event_id, name) DO NOTHING
        """,
        (event_id, name, datetime.now().isoformat(timespec="seconds")),
    )
    participant = db.execute(
        "SELECT id, name FROM participants WHERE event_id = ? AND name = ?",
        (event_id, name),
    ).fetchone()
    db.execute("DELETE FROM responses WHERE participant_id = ?", (participant["id"],))
    db.executemany(
        "INSERT INTO responses (participant_id, day, slot, value) VALUES (?, ?, ?, ?)",
        [(participant["id"], day, slot, value) for day, slot, value in rows],
    )
    db.commit()
    return jsonify({"ok": True, "name": participant["name"], "answered": len(rows)})


@app.get("/api/e/<event_id>/results")
def results_data(event_id):
    ev = get_event(event_id)
    db = get_db()
    participants = db.execute(
        "SELECT name FROM participants WHERE event_id = ? ORDER BY name", (event_id,)
    ).fetchall()

    grouped = {}
    for row in db.execute(
        """
        SELECT r.day, r.slot, r.value, COUNT(*) AS total
        FROM responses r
        JOIN participants p ON p.id = r.participant_id
        WHERE p.event_id = ?
        GROUP BY r.day, r.slot, r.value
        """,
        (event_id,),
    ):
        cell = grouped.setdefault(row["day"], {}).setdefault(
            row["slot"], {"yes": 0, "maybe": 0, "no": 0, "score": 0}
        )
        key = {2: "yes", 1: "maybe", 0: "no"}[row["value"]]
        cell[key] = row["total"]
        cell["score"] += row["total"] * row["value"]

    empty_cell = {"yes": 0, "maybe": 0, "no": 0, "score": 0}
    matrix = []
    for day in event_days(ev):
        day_data = grouped.get(day, {})
        cells = [
            dict(day_data.get(i, empty_cell)) for i in range(slot_count(ev))
        ]
        matrix.append({"date": day, "label": format_day(day), "cells": cells})

    return jsonify(
        {
            "event": event_public(ev),
            "participants": [{"name": p["name"]} for p in participants],
            "matrix": matrix,
        }
    )


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.errorhandler(404)
def not_found(_error):
    return render_template("404.html"), 404


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = parse_int(os.environ.get("PORT"), 5000)
    debug = os.environ.get("FLASK_DEBUG") == "1"
    app.run(host=host, port=port, debug=debug)

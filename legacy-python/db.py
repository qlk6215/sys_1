"""SQLite 저장소. 팀 → 팀원 → 수업(슬롯) 구조."""

import secrets
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data.sqlite3"

SCHEMA = """
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    day TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    location TEXT
);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def _new_code() -> str:
    # 헷갈리는 글자(0/O, 1/I) 제외한 6자리
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


# ---- teams -------------------------------------------------------------

def create_team(name: str) -> dict:
    with connect() as conn:
        while True:
            code = _new_code()
            if not conn.execute("SELECT 1 FROM teams WHERE code = ?", (code,)).fetchone():
                break
        cur = conn.execute("INSERT INTO teams (code, name) VALUES (?, ?)", (code, name))
        return {"id": cur.lastrowid, "code": code, "name": name}


def get_team(code: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM teams WHERE code = ?", (code.upper(),)).fetchone()
        if row is None:
            return None
        members = [
            dict(m) | {"slots": [dict(s) for s in conn.execute(
                "SELECT id, name, day, start, end, location FROM slots WHERE member_id = ? ORDER BY day, start",
                (m["id"],))]}
            for m in conn.execute(
                "SELECT id, name FROM members WHERE team_id = ? ORDER BY id", (row["id"],))
        ]
        return {"id": row["id"], "code": row["code"], "name": row["name"], "members": members}


# ---- members -----------------------------------------------------------

def add_member(team_id: int, name: str) -> dict:
    token = secrets.token_urlsafe(24)
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO members (team_id, name, token) VALUES (?, ?, ?)", (team_id, name, token))
        return {"id": cur.lastrowid, "name": name, "token": token}


def get_member_by_token(member_id: int, token: str) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT id, team_id, name FROM members WHERE id = ? AND token = ?", (member_id, token)).fetchone()
        return dict(row) if row else None


def delete_member(member_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM members WHERE id = ?", (member_id,))


# ---- slots -------------------------------------------------------------

def replace_slots(member_id: int, slots: list[dict]) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM slots WHERE member_id = ?", (member_id,))
        conn.executemany(
            "INSERT INTO slots (member_id, name, day, start, end, location) VALUES (?, ?, ?, ?, ?, ?)",
            [(member_id, s["name"], s["day"], s["start"], s["end"], s.get("location")) for s in slots])

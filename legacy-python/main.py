from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import db
from scheduler import free_blocks
from timetable import ClassSlot, ExtractionError, Timetable, extract_timetable

MAX_IMAGE_BYTES = 10 * 1024 * 1024

app = FastAPI(title="팀플 캘린더")
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")
db.init_db()


# ---- pages -------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/t/{code}")
def team_page(code: str):
    return FileResponse(STATIC / "team.html")


# ---- teams -------------------------------------------------------------

class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


@app.post("/api/teams")
def create_team(body: TeamCreate):
    return db.create_team(body.name.strip())


@app.get("/api/teams/{code}")
def get_team(code: str):
    team = db.get_team(code)
    if team is None:
        raise HTTPException(404, "팀을 찾을 수 없습니다. 초대 코드를 확인해 주세요.")
    return team


@app.get("/api/teams/{code}/free")
def get_free(code: str, min_minutes: int = 60, max_absent: int = 0,
             day_start: str = "09:00", day_end: str = "21:00"):
    team = db.get_team(code)
    if team is None:
        raise HTTPException(404, "팀을 찾을 수 없습니다.")
    return free_blocks(team["members"], min_minutes=min_minutes, max_absent=max_absent,
                       day_start=day_start, day_end=day_end)


# ---- members -----------------------------------------------------------

class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=30)


@app.post("/api/teams/{code}/members")
def join_team(code: str, body: MemberCreate):
    team = db.get_team(code)
    if team is None:
        raise HTTPException(404, "팀을 찾을 수 없습니다.")
    return db.add_member(team["id"], body.name.strip())


def _auth(member_id: int, token: str | None) -> dict:
    member = db.get_member_by_token(member_id, token or "")
    if member is None:
        raise HTTPException(403, "본인 시간표만 수정할 수 있습니다.")
    return member


class SlotsUpdate(BaseModel):
    slots: list[ClassSlot]


@app.put("/api/members/{member_id}/slots")
def put_slots(member_id: int, body: SlotsUpdate, x_member_token: str | None = Header(default=None)):
    _auth(member_id, x_member_token)
    db.replace_slots(member_id, [s.model_dump() for s in body.slots])
    return {"ok": True}


@app.delete("/api/members/{member_id}")
def leave_team(member_id: int, x_member_token: str | None = Header(default=None)):
    _auth(member_id, x_member_token)
    db.delete_member(member_id)
    return {"ok": True}


# ---- timetable image ---------------------------------------------------

@app.post("/api/timetable/upload", response_model=Timetable)
def upload_timetable(file: UploadFile, first_hour: int = 9):
    """이미지에서 수업 시간을 추출만 한다. 저장은 사용자가 확인한 뒤 PUT /slots 로."""
    if not 6 <= first_hour <= 12:
        raise HTTPException(400, "첫 시간은 6~12시 사이여야 합니다.")
    data = file.file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "이미지는 10MB 이하만 올릴 수 있습니다.")
    try:
        return extract_timetable(data, first_hour)
    except ExtractionError as e:
        raise HTTPException(422, str(e))

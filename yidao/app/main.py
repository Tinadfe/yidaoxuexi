"""医道学堂 MVP —— FastAPI 主服务
复用灵犀笔记同款架构：FastAPI + SQLAlchemy + SQLite，前端 PWA 静态托管。
启动：uvicorn app.main:app --host 0.0.0.0 --port 8700
"""
import json
import os
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, func, text

from database import SEED_DIR, AUDIO_DIR, BASE_DIR
from models import engine, Base, Card, Review, Practice, Question
from sqlalchemy.orm import Session

app = FastAPI(title="医道学堂", version="1.0.0")

SPACING = [1, 2, 4, 7, 15, 30]  # 艾宾浩斯复习间隔（天）
PRACTICE_ITEMS = {"baduanjin": "八段锦", "zhanzhuang": "站桩", "jingzuo": "静坐"}


# ---------------- 启动：建表 + 空库自动导入种子内容 ----------------
@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        if db.scalar(select(func.count(Card.id))) == 0:
            _import_seed(db)


def _import_seed(db: Session):
    """首次启动自动导入 data/seed 下的内容库"""
    files = {"tao.json": "tao", "tcm.json": "tcm", "acup.json": "acup"}
    for fname, expected_type in files.items():
        path = os.path.join(SEED_DIR, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            cards = json.load(f)
        for i, c in enumerate(cards):
            db.add(Card(
                type=c.get("type", expected_type),
                category=c.get("category", ""),
                title=c.get("title", ""),
                subtitle=c.get("subtitle", ""),
                front_text=c.get("front_text", ""),
                front_hint=c.get("front_hint", ""),
                back=c.get("back", []),
                audio=c.get("audio", ""),
                seq=c.get("seq", i),
            ))
    db.commit()


# ---------------- 工具 ----------------
def _card_out(db: Session, card: Card, with_review: bool = False) -> dict:
    audio_url = ""
    if card.audio:
        p = os.path.join(AUDIO_DIR, card.audio)
        if os.path.exists(p):
            audio_url = "/audio/" + card.audio
    d = {
        "id": card.id, "type": card.type, "category": card.category,
        "title": card.title, "subtitle": card.subtitle,
        "front_text": card.front_text, "front_hint": card.front_hint,
        "back": card.back, "audio_url": audio_url,
    }
    if with_review:
        r = db.scalar(select(Review).where(Review.card_id == card.id))
        d["is_review"] = bool(r)
    return d


def _today_done_count(db: Session) -> int:
    return db.scalar(
        select(func.count(Review.id)).where(Review.last_reviewed_at >= datetime.combine(date.today(), datetime.min.time()))
    ) or 0


def _streak(db: Session) -> int:
    # SQLite 的 date() 返回字符串；用纯 SQL 写法，兼容 SQLAlchemy 2.0.30
    rows = db.execute(
        text("SELECT DISTINCT date(created_at) AS d FROM practices ORDER BY d DESC LIMIT 400")
    ).scalars().all()
    # SQLite 的 date() 返回字符串，统一转成 date 对象再比较
    days = {(date.fromisoformat(str(r)) if not isinstance(r, date) else r) for r in rows}
    cur = date.today()
    if cur not in days:            # 今天还没打卡，从昨天起算（保留火种）
        cur -= timedelta(days=1)
    n = 0
    while cur in days:
        n += 1
        cur -= timedelta(days=1)
    return n


# ---------------- API：今日 ----------------
@app.get("/api/today")
def api_today():
    with Session(engine) as db:
        today = date.today()
        learned_ids = set(db.scalars(select(Review.card_id)).all())

        # 新卡：医类 1 张 + 道家 1 张（按 seq 顺序）
        mq = select(Card).where(Card.type.in_(["tcm", "acup"]))
        tq = select(Card).where(Card.type == "tao")
        if learned_ids:
            mq = mq.where(~Card.id.in_(learned_ids))
            tq = tq.where(~Card.id.in_(learned_ids))
        medical = db.scalars(mq.order_by(Card.seq, Card.id).limit(1)).all()
        tao = db.scalars(tq.order_by(Card.seq, Card.id).limit(1)).all()
        new_cards = [_card_out(db, c) for c in medical + tao]

        # 复习：到期卡（含今天），最多 5 张
        due = db.scalars(
            select(Review).where(Review.next_review_at <= today).order_by(Review.next_review_at).limit(5)
        ).all()
        review_cards = []
        for r in due:
            c = db.get(Card, r.card_id)
            if c:
                cd = _card_out(db, c)
                cd["due_days"] = (today - r.next_review_at).days
                review_cards.append(cd)

        plan = len(new_cards) + len(review_cards)          # 今日卡片计划
        done_today = _today_done_count(db)                  # 今天已学卡数（含复习）

        # 功法
        p_today = db.scalar(
            select(func.count(Practice.id)).where(Practice.created_at >= datetime.combine(today, datetime.min.time()))
        ) or 0
        return {
            "date": str(today),
            "new_cards": new_cards,
            "review_cards": review_cards,
            "plan": plan,
            "done_today": done_today,
            "cards_done": done_today >= plan and plan > 0 or (plan == 0 and done_today > 0),
            "practice_done": p_today > 0,
            "streak": _streak(db),
        }


# ---------------- API：提交学习结果 ----------------
class ReviewIn(BaseModel):
    card_id: int
    result: str  # got / again


@app.post("/api/review")
def api_review(body: ReviewIn):
    if body.result not in ("got", "again"):
        raise HTTPException(400, "result 只能是 got / again")
    with Session(engine) as db:
        card = db.get(Card, body.card_id)
        if not card:
            raise HTTPException(404, "卡片不存在")
        today = date.today()
        r = db.scalar(select(Review).where(Review.card_id == body.card_id))
        if r is None:
            r = Review(card_id=body.card_id, first_seen_at=today,
                       next_review_at=today, review_count=0)
            db.add(r)
        r.last_result = body.result
        r.last_reviewed_at = datetime.now()
        if body.result == "got":
            r.review_count += 1
            idx = min(r.review_count, len(SPACING)) - 1
            r.next_review_at = today + timedelta(days=SPACING[idx])
            if r.review_count >= len(SPACING):
                r.status = "mastered"
        else:  # again：明天再见，次数不清零、不进阶
            r.next_review_at = today + timedelta(days=1)
        db.commit()
        return {"ok": True, "card_id": body.card_id,
                "next_review": str(r.next_review_at), "status": r.status}


# ---------------- API：功法打卡 ----------------
class PracticeIn(BaseModel):
    item: str = "baduanjin"
    minutes: int = 15
    note: str = ""


@app.post("/api/practice/checkin")
def api_checkin(body: PracticeIn):
    if body.item not in PRACTICE_ITEMS:
        raise HTTPException(400, "item 必须是 " + "/".join(PRACTICE_ITEMS))
    with Session(engine) as db:
        db.add(Practice(item=body.item, minutes=max(1, min(body.minutes, 180)),
                        note=body.note[:255], created_at=datetime.now()))  # 本地时间，避免 UTC 错位
        db.commit()
        return {"ok": True, "streak": _streak(db), "item": PRACTICE_ITEMS[body.item]}


@app.get("/api/practice/history")
def api_practice_history(limit: int = 30):
    with Session(engine) as db:
        rows = db.scalars(select(Practice).order_by(Practice.created_at.desc()).limit(limit)).all()
        return [{"item": r.item, "item_name": PRACTICE_ITEMS.get(r.item, r.item),
                 "minutes": r.minutes, "note": r.note,
                 "time": r.created_at.strftime("%m-%d %H:%M")} for r in rows]


# ---------------- API：统计 ----------------
@app.get("/api/stats")
def api_stats():
    with Session(engine) as db:
        total = db.scalar(select(func.count(Card.id))) or 0
        learned = db.scalar(select(func.count(func.distinct(Review.card_id)))) or 0
        mastered = db.scalar(select(func.count(Review.id)).where(Review.status == "mastered")) or 0
        tao_total = db.scalar(select(func.count(Card.id)).where(Card.type == "tao")) or 0
        tao_learned = db.execute(
            select(func.count(Review.id)).join(Card, Review.card_id == Card.id).where(Card.type == "tao")
        ).scalar() or 0
        # 分类进度
        rows = db.execute(
            select(Card.category,
                   func.count(Card.id),
                   func.count(Review.id))
            .outerjoin(Review, Review.card_id == Card.id)
            .group_by(Card.category)
        ).all()
        breakdown = [{"category": r[0], "total": r[1], "learned": r[2]} for r in rows]
        return {
            "total_cards": total, "learned": learned, "mastered": mastered,
            "learn_pct": round(learned / total * 100, 1) if total else 0,
            "tao_progress": f"{tao_learned}/{tao_total}",
            "streak": _streak(db),
            "practice_total": db.scalar(select(func.count(Practice.id))) or 0,
            "breakdown": breakdown,
        }


# ---------------- 静态：前端 + 音频 ----------------
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "app", "static")), name="static")


# ---------------- API：书架（全库查阅） ----------------
TYPE_NAMES = {"tao": "道德经", "tcm": "药材", "acup": "穴位"}

@app.get("/api/library")
def api_library(q: str = "", type: str = ""):
    """全库轻量列表：搜索标题/拼音/分类/正文，type 可过滤"""
    with Session(engine) as db:
        query = select(Card)
        if type in TYPE_NAMES:
            query = query.where(Card.type == type)
        if q.strip():
            kw = f"%{q.strip()}%"
            query = query.where(
                Card.title.like(kw) | Card.subtitle.like(kw) |
                Card.category.like(kw) | Card.front_text.like(kw) |
                Card.front_hint.like(kw)
            )
        rows = db.scalars(query.order_by(Card.type.desc(), Card.seq, Card.id)).all()
        out = []
        for c in rows:
            out.append({
                "id": c.id, "type": c.type, "type_name": TYPE_NAMES.get(c.type, c.type),
                "category": c.category, "title": c.title, "subtitle": c.subtitle,
                "preview": (c.front_text[:40] + "…") if len(c.front_text) > 40
                           else (c.front_text or c.front_hint),
                "has_audio": bool(c.audio and os.path.exists(os.path.join(AUDIO_DIR, c.audio))),
            })
        return {"total": len(out), "items": out}


@app.get("/api/card/{card_id}")
def api_card(card_id: int):
    """单卡完整详情（书架点开时用）"""
    with Session(engine) as db:
        c = db.get(Card, card_id)
        if not c:
            raise HTTPException(404, "卡片不存在")
        return _card_out(db, c)


# ---------------- API：学习问答（AI 助教） ----------------
ASK_SYSTEM = (
    "你是「医道学堂」App 的助教，用户在学习中医（药材、穴位）与道家经典（道德经）。"
    "回答规则：1) 简洁口语化，不超过200字，可分点；2) 概念讲清'是什么+为什么好记'；"
    "3) 涉及具体健康问题必须提醒'具体调理请咨询专业医师'；4) 与中医道家无关的问题，礼貌引导回学习话题。"
)

def _dashscope_key() -> str:
    """Key 来源：环境变量 DASHSCOPE_API_KEY 优先，其次 data/config.json 的 dashscope_api_key"""
    k = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if k:
        return k
    cfg_path = os.path.join(BASE_DIR, "data", "config.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, encoding="utf-8") as f:
                return str(json.load(f).get("dashscope_api_key", "")).strip()
        except Exception:
            return ""
    return ""

class AskIn(BaseModel):
    question: str
    card_id: int = 0

@app.post("/api/ask")
def api_ask(body: AskIn):
    q = body.question.strip()[:500]
    if not q:
        raise HTTPException(400, "问题不能为空")
    # 组装卡片上下文
    ctx = ""
    if body.card_id:
        with Session(engine) as db:
            c = db.get(Card, body.card_id)
            if c:
                pts = "；".join(r[1] for r in (c.back or [])[:2])
                ctx = f"【用户正在学习这张卡】{c.title}（{c.category}）：{(c.front_text or c.front_hint)[:120]}" + (f"｜要点：{pts[:150]}" if pts else "") + "\n"
    answer, ok = "", True
    key = _dashscope_key()
    if not key:
        ok = False
        answer = "（AI 助教还没接入钥匙：需要通义 DashScope API Key。你的问题已记录下来，配置好 Key 后重新问即可。）"
    else:
        try:
            import requests
            resp = requests.post(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": "qwen-turbo",
                    "messages": [
                        {"role": "system", "content": ASK_SYSTEM},
                        {"role": "user", "content": ctx + q},
                    ],
                },
                timeout=30,
            )
            data = resp.json()
            answer = str(data["choices"][0]["message"]["content"]).strip()
        except Exception:
            ok = False
            answer = "AI 助教暂时联系不上（网络或额度问题），问题已记录，稍后再试。"
    with Session(engine) as db:
        db.add(Question(question=q, answer=answer if ok else "", card_id=body.card_id or None))
        db.commit()
    return {"ok": ok, "answer": answer}

@app.get("/api/ask/history")
def api_ask_history(limit: int = 20):
    with Session(engine) as db:
        rows = db.scalars(
            select(Question).order_by(Question.id.desc()).limit(min(limit, 50))
        ).all()
        return [{"id": r.id, "question": r.question, "answer": r.answer,
                 "card_id": r.card_id, "time": r.created_at.strftime("%m-%d %H:%M")}
                for r in rows]


@app.get("/")
def index():
    return FileResponse(os.path.join(BASE_DIR, "app", "static", "index.html"))


@app.get("/sw.js")
def sw_js():
    """Service Worker 挂根路径，作用域才能覆盖整站（/static/ 下注册 scope 不含首页）"""
    return FileResponse(
        os.path.join(BASE_DIR, "app", "static", "sw.js"),
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache"},
    )

"""数据模型 —— MVP 三张表：cards（内容库）/ reviews（学习进度）/ practices（功法打卡）"""
from datetime import date, datetime
from sqlalchemy import Integer, String, Text, Date, DateTime, JSON, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from database import DATABASE_URL
from sqlalchemy import create_engine

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class Base(DeclarativeBase):
    pass


class Card(Base):
    """内容卡片：药材 / 穴位 / 道德经章节"""
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(16), index=True)      # tcm 药材 / acup 穴位 / tao 道德经
    category: Mapped[str] = mapped_column(String(64))               # 如：补气药 / 足阳明胃经 / 上篇
    title: Mapped[str] = mapped_column(String(128))                 # 黄芪 / 足三里 / 第八章
    subtitle: Mapped[str] = mapped_column(String(255), default="")  # 拼音 / 穴位编号 / 首句
    front_text: Mapped[str] = mapped_column(Text, default="")      # 正面长文本（道德经原文）
    front_hint: Mapped[str] = mapped_column(String(255), default="")
    back: Mapped[list] = mapped_column(JSON)                        # [[标签, 内容], ...]
    audio: Mapped[str] = mapped_column(String(255), default="")     # data/audio 下相对路径，可空
    seq: Mapped[int] = mapped_column(Integer, default=0)            # 学习顺序


class Review(Base):
    """学习进度：一卡一行，驱动艾宾浩斯复习队列"""
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("card_id", name="uq_review_card"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[int] = mapped_column(Integer, index=True)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="learning")  # learning / mastered
    next_review_at: Mapped[date] = mapped_column(Date, index=True)       # 下次复习日期
    last_result: Mapped[str] = mapped_column(String(8), default="")     # got / again
    first_seen_at: Mapped[date] = mapped_column(Date)
    last_reviewed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Practice(Base):
    """功法打卡：八段锦 / 站桩 / 静坐"""
    __tablename__ = "practices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item: Mapped[str] = mapped_column(String(32))                  # baduanjin / zhanzhuang / jingzuo
    minutes: Mapped[int] = mapped_column(Integer, default=15)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Question(Base):
    """学习问答：向 AI 助教提问的记录（含未接入 Key 时的问题暂存）"""
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[int] = mapped_column(Integer, nullable=True)   # 关联卡片，可空
    question: Mapped[str] = mapped_column(String(500))
    answer: Mapped[str] = mapped_column(Text, default="")           # 空 = 尚未成功回答
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


Base.metadata.create_all(engine)

"""数据库配置 —— 沿用灵犀笔记同款方案：SQLite + SQLAlchemy"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "yidao.db")
SEED_DIR = os.path.join(DATA_DIR, "seed")
AUDIO_DIR = os.path.join(DATA_DIR, "audio")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(AUDIO_DIR, exist_ok=True)

# 备用：整个数据库就是 data/yidao.db 一个文件，改任何东西前先复制一份即可
DATABASE_URL = "sqlite:///" + DB_PATH

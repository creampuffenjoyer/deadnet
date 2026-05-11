import asyncio, sys
sys.path.insert(0, "/app")
from app.utils.security import hash_password
from app.database import AsyncSessionLocal
from sqlalchemy import text

async def main():
    h = hash_password("Admin@Deadnet1")
    async with AsyncSessionLocal() as db:
        stmt = text("UPDATE users SET hashed_password = :h WHERE username = 'admin'")
        await db.execute(stmt, {"h": h})
        await db.commit()
    print("Reset done. Hash prefix:", h[:25])

asyncio.run(main())

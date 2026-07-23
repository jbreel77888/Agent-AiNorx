import asyncio
import asyncpg

DB_URL = "postgresql://postgres.lnmyqdukyyxfwmqpnrqr:bD1fCiHymBoiCIPg@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require"

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS kortix.account_registry_items (
    item_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id     uuid NOT NULL,
    name           text NOT NULL,
    type           text NOT NULL DEFAULT 'skill',
    source_address text,
    content_hash   text,
    skill_content  text NOT NULL,
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active      boolean NOT NULL DEFAULT true,
    version        integer NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_registry_items_account
    ON kortix.account_registry_items(account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_registry_items_account_name
    ON kortix.account_registry_items(account_id, name);
"""

async def main():
    conn = await asyncpg.connect(DB_URL)
    try:
        for stmt in MIGRATION_SQL.strip().split(';'):
            stmt = stmt.strip()
            if not stmt:
                continue
            print(f"  > {stmt[:80]}...")
            await conn.execute(stmt)
        print("Migration applied successfully")
        rows = await conn.fetch(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'kortix' AND table_name = 'account_registry_items'"
        )
        print(f"Verify: account_registry_items exists = {len(rows) > 0}")
    finally:
        await conn.close()

asyncio.run(main())

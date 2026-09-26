import logging
import sys
from pathlib import Path

from sqlalchemy import func, text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.models import *  # noqa: F401,F403
from app.services.data_loader import DataLoader
from app.services.matching_engine import MatchingEngine

logger = logging.getLogger(__name__)


def generate_seed_matches(session) -> int:
    """Populate the matches table from the loaded donation and shelter datasets.

    This keeps the app production-ready without forcing a manual match-generation
    step in the UI. Only generate records when the table is empty so repeated
    startup calls do not duplicate data.
    """
    existing_count = session.query(Match).count()
    if existing_count > 0:
        logger.info("Match table already contains %s rows; skipping automatic generation.", existing_count)
        return existing_count

    matching_engine = MatchingEngine(session)
    donations = session.query(Donation).order_by(Donation.id).all()
    generated_total = 0

    for donation in donations:
        saved_matches = matching_engine.generate_and_save_matches_for_donation(str(donation.id))
        generated_total += len(saved_matches)

    logger.info("Generated %s match rows from %s donations.", generated_total, len(donations))
    return generated_total


def reset_primary_key_sequences(session) -> None:
    """Align auto-increment sequences with the highest explicit primary key already in the database.

    The bundled CSV seeders insert rows using explicit numeric IDs (for example, donation_id values
    pulled from the dataset). Postgres does not advance its sequence automatically in that case, so the
    next created donation can attempt to reuse id=1 and fail with a unique-constraint error.
    """
    tables = [
        Restaurant,
        Shelter,
        Donation,
        Volunteer,
        Match,
        Rescue,
        Pickup,
        AgentLog,
        User,
    ]

    for model in tables:
        table = model.__table__
        pk = next(iter(table.primary_key.columns), None)
        if pk is None:
            continue

        try:
            max_id = session.query(func.max(pk)).scalar() or 0
            if max_id <= 0:
                continue

            dialect = session.bind.dialect.name if session.bind is not None else ""
            if dialect == "postgresql":
                sequence_name = f"{table.name}_{pk.name}_seq"
                session.execute(text(f"SELECT setval('{sequence_name}', {max_id}, true)"))
            elif dialect == "sqlite":
                session.execute(text("DELETE FROM sqlite_sequence WHERE name = :table_name"), {"table_name": table.name})
                session.execute(text("INSERT INTO sqlite_sequence (name, seq) VALUES (:table_name, :max_id)"), {
                    "table_name": table.name,
                    "max_id": max_id,
                })
        except Exception:
            logger.warning("Could not update sequence for %s; the database may still accept auto-generated IDs.", table.name, exc_info=True)

    session.commit()


def init_db(reset: bool = False) -> None:
    """Create tables and seed the database only when it is empty; then align sequence counters."""
    if reset:
        Base.metadata.drop_all(bind=engine)

    Base.metadata.create_all(bind=engine)

    data_dir = Path(__file__).resolve().parents[2] / "datasets" / "Datasets"
    if not data_dir.exists():
        logger.warning("Dataset directory not found at %s; database tables were created without seeding.", data_dir)
        return

    try:
        with SessionLocal() as session:
            seeded_tables = [Restaurant, Shelter, Donation, Volunteer, FoodTaxonomy]
            has_seed_data = any(session.query(model).count() > 0 for model in seeded_tables)

            if not reset and has_seed_data:
                logger.info("Database already contains seed data; skipping CSV reload and ensuring match rows exist.")
                generate_seed_matches(session)
                reset_primary_key_sequences(session)
                return

            loader = DataLoader(session)
            counts = loader.load_all_data()
            generate_seed_matches(session)
            reset_primary_key_sequences(session)
            logger.info("Database initialization complete with dataset counts: %s", counts)
    except Exception as exc:  # pragma: no cover - defensive bootstrapping
        logger.exception("Database tables were created but dataset seeding failed: %s", exc)


if __name__ == "__main__":
    init_db()
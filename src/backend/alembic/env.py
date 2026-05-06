from __future__ import with_statement
import sys
import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# ensure the project src directory is on sys.path so `import backend` works
repo_src = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if repo_src not in sys.path:
    sys.path.insert(0, repo_src)

from backend.db import Base
from backend.config import DATABASE_URL

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
try:
    fileConfig(config.config_file_name)
except Exception:
    # If alembic.ini logging sections are incomplete, skip logging config
    pass

# set the SQLAlchemy url programmatically
config.set_main_option('sqlalchemy.url', DATABASE_URL)

target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix='sqlalchemy.',
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

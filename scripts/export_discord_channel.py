from __future__ import annotations

from pathlib import Path
import sys


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    if str(script_dir) not in sys.path:
        sys.path.insert(0, str(script_dir))

    import export_discord_server

    return export_discord_server.main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
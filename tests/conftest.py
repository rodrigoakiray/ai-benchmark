import sys
from pathlib import Path

# as tools importam umas às outras como módulos de primeiro nível (import lake)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

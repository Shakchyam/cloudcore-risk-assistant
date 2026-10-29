"""Launcher for MCP clients that can't set a working directory (e.g. Claude Desktop)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cloudcore.server import mcp
mcp.run()

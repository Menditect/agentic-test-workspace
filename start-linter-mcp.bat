@echo off
set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%scripts\mta-lint-mcp.js" --http %*

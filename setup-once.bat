@echo off
REM Run this ONCE after cloning, on Windows, with Docker Desktop and Node.js installed.
REM It installs dependencies, creates env files, starts Postgres, applies the
REM schema, and seeds the login accounts. Safe to re-run. Then use start-all.bat.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-once.ps1"

@echo off
REM Double-click this to bring up the whole Event Ops stack:
REM   Docker + Postgres  ->  backend (:3000)  ->  frontend (:3001)  ->  share link (:8080)
REM It just runs start-all.ps1 next to it, bypassing PowerShell's execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1"

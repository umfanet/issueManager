@echo off
echo ========================================
echo  Issue Manager - Build
echo ========================================
echo.

:: Read version from config.py
for /f "tokens=2 delims='" %%a in ('findstr /C:"VERSION" config.py') do set VERSION=%%a

echo Building version: %VERSION%
echo.

pyinstaller --noconfirm --onefile --name "IssueManager %VERSION%" --icon icon.ico ^
    --add-data "templates;templates" ^
    --add-data "static;static" ^
    --hidden-import openpyxl ^
    --hidden-import xlrd ^
    --hidden-import lxml ^
    --hidden-import html5lib ^
    --hidden-import jinja2.ext ^
    --hidden-import win32com ^
    --hidden-import win32com.client ^
    --hidden-import pythoncom ^
    --hidden-import pywintypes ^
    --hidden-import win32timezone ^
    app.py

echo.
if exist "dist\IssueManager %VERSION%.exe" (
    echo [SUCCESS] Build complete!
    echo Output: dist\IssueManager %VERSION%.exe
) else (
    echo [ERROR] Build failed. Check the output above.
)
pause

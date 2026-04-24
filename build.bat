@echo off
echo ========================================
echo  Issue Manager - Build
echo ========================================
echo.

pyinstaller --noconfirm --onefile --name IssueManager ^
    --add-data "templates;templates" ^
    --hidden-import openpyxl ^
    --hidden-import xlrd ^
    --hidden-import jinja2.ext ^
    app.py

echo.
if exist "dist\IssueManager.exe" (
    echo [SUCCESS] Build complete!
    echo Output: dist\IssueManager.exe
    echo.
    echo This single .exe file is all you need to distribute.
) else (
    echo [ERROR] Build failed. Check the output above.
)
pause

"""
xlsx_parser/sheet_cleaner.py (web version)
In-memory xlsx tab cleaner — no file I/O.
"""

import io
import openpyxl

SUBSTRING_MATCH = True
CASE_SENSITIVE  = False


def _tab_matches(tab_name: str, benefits: list) -> bool:
    name = tab_name.strip()
    if not CASE_SENSITIVE:
        name = name.lower()
    for benefit in benefits:
        b = benefit.strip()
        if not CASE_SENSITIVE:
            b = b.lower()
        if SUBSTRING_MATCH:
            if b in name:
                return True
        else:
            if name == b:
                return True
    return False


def clean_file_bytes(file_bytes: bytes, filename: str, benefits: list, dry_run: bool = True) -> dict:
    """
    Cleans an xlsx file from bytes. Returns result dict.
    If dry_run=False and status=ok, result includes 'cleaned_bytes'.
    """
    result = {
        "file":         filename,
        "tabs_before":  [],
        "tabs_kept":    [],
        "tabs_removed": [],
        "tabs_renamed": [],
        "status":       "ok",
        "note":         "",
    }

    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    except Exception as e:
        result["status"] = "error"
        result["note"]   = f"Could not open file: {e}"
        return result

    raw_names = wb.sheetnames
    result["tabs_before"] = list(raw_names)

    to_remove = []
    for name in raw_names:
        if _tab_matches(name, benefits):
            if name != name.strip():
                result["tabs_renamed"].append({"from": name, "to": name.strip()})
            result["tabs_kept"].append(name.strip())
        else:
            to_remove.append(name)

    for name in to_remove:
        result["tabs_removed"].append(name)

    if not result["tabs_kept"]:
        result["status"] = "skipped"
        result["note"]   = "No matching tabs found."
        wb.close()
        return result

    if dry_run:
        wb.close()
        return result

    # Apply mutations
    for name in to_remove:
        del wb[name]
    for rename in result["tabs_renamed"]:
        wb[rename["from"]].title = rename["to"]

    buf = io.BytesIO()
    wb.save(buf)
    wb.close()
    result["cleaned_bytes"] = buf.getvalue()
    return result

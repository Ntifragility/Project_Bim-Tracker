# Excel ↔ IFC Viewer Bridge

This directory contains the Python bridge services that connect local Excel spreadsheets to the browser-based 3D IFC Viewer in real-time.

---

## Prerequisites

1. **Python**: Ensure you have Python installed and available.
2. **Pip dependencies**: Install packages using:
   ```bash
   pip install -r requirements.txt
   ```
   *   `websockets` — manages the async WebSocket communication hub.
   *   `xlwings` — handles Windows Excel selection event tracking.
3. **Excel File**: Excel must be open on the same machine with GUIDs in **Column B**.

---

## File Structure

```
excel-ifc-bridge/
├── main.py            ← Entry point. Runs both services concurrently.
├── server.py          ← WebSocket server (ws://localhost:3001)
├── bridge.py          ← xlwings Excel event watcher client
└── requirements.txt   ← Python pip dependencies
```

---

## How to Run

1. Open your Excel spreadsheet workbook.
2. In your terminal, navigate to this directory and run the entry point:
   ```bash
   python main.py
   ```
3. Open the IFC viewer in your browser (at `http://localhost:5175/`).
4. Click any cell in Excel. The corresponding GUID in Column B is read and sent to the browser viewer to automatically select and highlight the component in 3D.
5. Alternatively, click any component in the browser's 3D viewport to automatically select and scroll to the matching row in Excel!

---

## Configuration

Constants are defined at the top of each script to allow easy modification:
*   `PORT`: WebSocket communication port (Default: `3001`).
*   `GUID_COLUMN`: Column character containing the IFC identifiers (Default: `"B"`).
*   `POLL_INTERVAL`: Delay in seconds between Excel selection checks (Default: `0.2`).

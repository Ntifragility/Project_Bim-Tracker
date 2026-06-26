# Excel → IFC viewer bridge

## Project overview

This tool links a Microsoft Excel file to a locally running IFC viewer in the browser. When a user clicks a cell in Excel, the corresponding IFC element is automatically highlighted in the 3D viewer. It is the first module of a larger BIM project progress tracking system.

The IFC viewer is already built and running on localhost using That Open Company's engine (`web-ifc`, Fragments, and the Highlighter component). The agent's job is to build the bridge between Excel and the browser — nothing else.

---

## How it works

```
User clicks a cell in Excel
        ↓
xlwings detects the SelectionChange event
        ↓
Python reads the IFC GlobalId (GUID) from that row
        ↓
Python sends the GUID over WebSocket to localhost:3001
        ↓
Browser viewer receives the GUID
        ↓
That Open Company Highlighter selects the matching element
```

---

## Architecture

### Components

| Component | Language | Responsibility |
|---|---|---|
| `bridge.py` | Python | Watches Excel, sends GUID over WebSocket |
| `server.py` | Python | Local WebSocket server on port 3001 |
| `viewer-socket.js` | JavaScript | Receives GUID, calls Highlighter in browser |

### Key design decisions

- The WebSocket server runs locally on `ws://localhost:3001`
- Excel and the browser are on the same machine (no network involved)
- The GUID column in Excel is the single source of truth for element linking
- The bridge must not modify the Excel file in any way
- The viewer-side code must integrate cleanly with the existing That Open Company setup without breaking it

---

## Environment

The following are already installed and available:

- Python (virtual environment active)
- `xlwings` — for Excel ↔ Python communication
- Add any other pip packages needed (`websockets`, `asyncio`, etc.)

The IFC viewer is a web app running on localhost (port to be confirmed with the developer). It uses:

- `web-ifc` and Fragments (That Open Company engine)
- The `Highlighter` component from `@thatopen/components`

---

## Excel file structure

The agent should assume the Excel file has the following structure (confirm with developer before hardcoding):

| Column | Content |
|---|---|
| A | Element name (e.g. "Wall-001") |
| B | IFC GlobalId / GUID (e.g. `"2O2Fr$t4X7Zf8NOew3FLOH"`) |
| C+ | Progress data, notes, etc. (ignore for this feature) |

The GUID in column B is what gets sent to the viewer when that row's cell is clicked. If the user clicks any cell in a row, the GUID from column B of that same row is used.

---

## Tasks for the agent

### Task 1 — WebSocket server (`server.py`)

Build a lightweight WebSocket server using Python's `websockets` library.

Requirements:
- Listens on `ws://localhost:3001`
- Accepts connections from both the Python bridge and the browser
- When it receives a GUID message from the Python bridge, it broadcasts it to all connected browser clients
- Logs connections, disconnections, and received GUIDs to the console
- Handles errors gracefully (client disconnects, malformed messages)
- Must run as an `asyncio` event loop

Expected message format (plain string):
```
2O2Fr$t4X7Zf8NOew3FLOH
```

No JSON wrapping needed for MVP — plain GUID string is sufficient.

### Task 2 — Excel bridge (`bridge.py`)

Build the Python script that watches Excel for cell selection changes using xlwings.

Requirements:
- Uses `xlwings` to attach to an already-open Excel workbook (do not open a new one)
- Hooks into the `SelectionChange` event on the active sheet
- On each selection change, reads the GUID from column B of the selected row
- Skips the header row (row 1) and skips empty GUIDs
- Sends the GUID as a plain string to the WebSocket server at `ws://localhost:3001`
- Uses `websockets` client to send (reconnects automatically if server is not yet running)
- Logs every sent GUID to the console
- Must run alongside `server.py` — use `asyncio` or threads appropriately so both can run together, or document clearly how to run them

### Task 3 — Browser WebSocket listener (`viewer-socket.js`)

Build the client-side JavaScript that connects to the local WebSocket server and highlights IFC elements.

Requirements:
- Opens a WebSocket connection to `ws://localhost:3001` on page load
- Listens for incoming GUID messages
- On receiving a GUID, uses the That Open Company `Highlighter` component to select/highlight the matching element
- Reconnects automatically if the connection drops (use exponential backoff, max 5s delay)
- Logs received GUIDs and highlight results to the browser console
- Must not interfere with existing viewer functionality
- The developer will integrate this file into the existing viewer project — write it as a self-contained ES module that exports a single `initExcelBridge(components, world)` function, where `components` and `world` are the existing That Open Company instances

Expected integration call (the developer will add this to their existing viewer init):
```javascript
import { initExcelBridge } from './viewer-socket.js';
initExcelBridge(components, world);
```

### Task 4 — Entry point (`main.py`)

Create a single entry point that starts both the WebSocket server and the Excel bridge together.

Requirements:
- Runs `server.py` and `bridge.py` concurrently using `asyncio`
- Prints a clear startup message:
  ```
  BIM Bridge running.
  WebSocket server: ws://localhost:3001
  Watching Excel for cell selection...
  Press Ctrl+C to stop.
  ```
- Handles `KeyboardInterrupt` cleanly
- This is the file the user will run: `python main.py`

### Task 5 — README (`README.md`)

Write a short README for the developer covering:
- Prerequisites (Python env, xlwings, websockets)
- How to run: `python main.py`
- How to integrate `viewer-socket.js` into the existing viewer
- How the Excel file should be structured (GUID column)
- How to test it end-to-end

---

## File structure the agent should produce

```
excel-ifc-bridge/
├── main.py               ← entry point, run this
├── server.py             ← WebSocket server
├── bridge.py             ← xlwings Excel watcher
├── viewer-socket.js      ← browser-side WebSocket + highlighter
├── requirements.txt      ← websockets, xlwings (already installed but document)
└── README.md             ← setup and integration guide
```

---

## Constraints and notes

- Do not use Flask, FastAPI, or any HTTP framework — pure WebSocket only
- Do not use `threading` if `asyncio` can handle it cleanly
- The Excel file is opened by the user manually — the bridge attaches to it, never opens or saves it
- The GUID column letter (B) and the viewer port should be defined as constants at the top of each file so the developer can easily change them
- Write clean, well-commented code — another developer will maintain this
- All print/log output should be prefixed with a timestamp

---

## Definition of done

The feature is complete when:

1. Developer opens an Excel file with GUIDs in column B
2. Developer runs `python main.py`
3. Developer opens the IFC viewer in the browser
4. Developer clicks any cell in Excel
5. The corresponding IFC element is highlighted in the browser within 1 second
6. Clicking a different cell changes the highlighted element
7. No errors are thrown in Python console or browser console during normal use
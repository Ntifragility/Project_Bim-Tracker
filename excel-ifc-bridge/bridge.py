import asyncio
import datetime
import xlwings as xw
import websockets

# Configuration Constants
WS_URL = "ws://localhost:3001"
GUID_COLUMN = "B"       # Column B contains the GUID
POLL_INTERVAL = 0.2     # Poll every 200ms

# State management to prevent infinite communication feedback loops
last_received_guid = None

def get_timestamp():
    return datetime.datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")

async def select_excel_row_by_guid(guid):
    """Locate the row containing the GUID in Column B and select it in Excel."""
    global last_received_guid
    try:
        app = xw.apps.active
        if not app:
            return
        
        wb = app.books.active
        sheet = wb.sheets.active
        
        # Search Column B for the GUID
        col_b = sheet.range(f"{GUID_COLUMN}:{GUID_COLUMN}")
        cell = col_b.find(guid)
        
        if cell:
            print(f"{get_timestamp()} [Bridge] Selected GUID {guid} found at row {cell.row}. Selecting row in Excel...")
            # Store the GUID we are selecting programmatically so watch_excel ignores this event
            last_received_guid = guid
            # Select columns A-C of the found row
            sheet.range(f"A{cell.row}:C{cell.row}").select()
        else:
            print(f"{get_timestamp()} [Bridge] GUID {guid} not found in Column B of the active sheet.")
    except Exception as e:
        print(f"{get_timestamp()} [Bridge] Error selecting Excel row: {e}")

async def watch_excel():
    """Poll Excel active cell selection and yield new GUIDs."""
    global last_received_guid
    last_row = None
    last_book = None
    last_sheet = None
    
    print(f"{get_timestamp()} [Bridge] Starting Excel polling loop...")
    
    while True:
        try:
            app = xw.apps.active
            if app:
                wb = app.books.active
                sheet = wb.sheets.active
                selection = app.selection
                
                if selection:
                    current_row = selection.row
                    
                    # Trigger only if selection moved to a new row, workbook, or sheet
                    if current_row != last_row or wb.name != last_book or sheet.name != last_sheet:
                        last_row = current_row
                        last_book = wb.name
                        last_sheet = sheet.name
                        
                        # Skip header row (row 1)
                        if current_row > 1:
                            # Read GUID value
                            guid = sheet.range(f"{GUID_COLUMN}{current_row}").value
                            if guid:
                                guid_str = str(guid).strip()
                                
                                # Ignore if this selection was triggered programmatically by a 3D click
                                if guid_str == last_received_guid:
                                    # Reset state so further clicks on the same row can trigger again
                                    last_received_guid = None
                                    continue
                                
                                # Reset matching state on user-initiated click of a different cell
                                last_received_guid = None
                                
                                if guid_str:
                                    print(f"{get_timestamp()} [Bridge] Row change detected (Row {current_row}). Read GUID: {guid_str}")
                                    yield guid_str
        except Exception:
            # Excel is either in Edit Mode, busy, or closed. Pass to retry on next poll.
            pass
            
        await asyncio.sleep(POLL_INTERVAL)

async def run_bridge():
    """Maintain connection to WebSocket server and pipe Excel selections."""
    while True:
        try:
            print(f"{get_timestamp()} [Bridge] Connecting to WebSocket server at {WS_URL}...")
            async with websockets.connect(WS_URL) as ws:
                print(f"{get_timestamp()} [Bridge] Connected successfully to WebSocket server.")
                
                # Task to receive GUIDs from the browser (Bidirectional Sync)
                async def receive_from_browser():
                    try:
                        async for message in ws:
                            guid = str(message).strip()
                            if guid:
                                await select_excel_row_by_guid(guid)
                    except websockets.exceptions.ConnectionClosed:
                        print(f"{get_timestamp()} [Bridge] WebSocket connection closed by server.")
                
                # Start listener task
                listener_task = asyncio.create_task(receive_from_browser())
                
                # Poll Excel and send GUIDs
                async for guid in watch_excel():
                    await ws.send(guid)
                    print(f"{get_timestamp()} [Bridge] Sent GUID to WebSocket server: {guid}")
                
                await listener_task
                
        except (ConnectionRefusedError, OSError, websockets.exceptions.ConnectionClosed):
            print(f"{get_timestamp()} [Bridge] Connection to WebSocket failed. Retrying in 3 seconds...")
            await asyncio.sleep(3)
        except Exception as e:
            print(f"{get_timestamp()} [Bridge] Error in main bridge loop: {e}. Retrying in 3 seconds...")
            await asyncio.sleep(3)

if __name__ == "__main__":
    try:
        asyncio.run(run_bridge())
    except KeyboardInterrupt:
        print(f"\n{get_timestamp()} [Bridge] Watcher stopped by user.")

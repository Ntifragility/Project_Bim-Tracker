import asyncio
import datetime
from server import start_server
from bridge import run_bridge

def get_timestamp():
    return datetime.datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")

async def main():
    print(f"{get_timestamp()} [Orchestrator] Launching Excel-IFC Bridge Services...")
    
    # Start the local WebSocket broadcast server
    server = await start_server()
    
    # Display the startup banner
    print("\n" + "=" * 60)
    print("  BIM Bridge running.")
    print("  WebSocket server: ws://localhost:3001")
    print("  Watching Excel for cell selection...")
    print("  Press Ctrl+C to stop.")
    print("=" * 60 + "\n")
    
    # Gather both tasks concurrently:
    # 1. server.wait_closed() keeps the server listening for events.
    # 2. run_bridge() connects to the server and polls the Excel worksheet.
    try:
        await asyncio.gather(
            server.wait_closed(),
            run_bridge()
        )
    except asyncio.CancelledError:
        pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{get_timestamp()} [Orchestrator] BIM Bridge stopped by user. Exiting cleanly.")

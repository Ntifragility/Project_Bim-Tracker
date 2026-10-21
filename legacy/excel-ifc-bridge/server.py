import asyncio
import datetime
import websockets

# Constants
PORT = 3001
HOST = "localhost"

# Active client connections
clients = set()

def get_timestamp():
    return datetime.datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")

async def handler(websocket):
    # Register client
    clients.add(websocket)
    print(f"{get_timestamp()} [Server] Client connected from {websocket.remote_address}. Active connections: {len(clients)}")
    
    try:
        async for message in websocket:
            print(f"{get_timestamp()} [Server] Received message: {message}")
            
            # Broadcast message to all other connected clients
            disconnected_clients = []
            for client in clients:
                if client != websocket:
                    try:
                        await client.send(message)
                    except websockets.exceptions.ConnectionClosed:
                        disconnected_clients.append(client)
                    except Exception as e:
                        print(f"{get_timestamp()} [Server] Error sending message: {e}")
            
            # Clean up disconnected clients found during broadcast
            for client in disconnected_clients:
                if client in clients:
                    clients.remove(client)
                    
    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"{get_timestamp()} [Server] Handler error: {e}")
    finally:
        # Unregister client
        if websocket in clients:
            clients.remove(websocket)
        print(f"{get_timestamp()} [Server] Client disconnected. Active connections: {len(clients)}")

async def start_server():
    print(f"{get_timestamp()} [Server] Starting WebSocket server on ws://{HOST}:{PORT}...")
    server = await websockets.serve(handler, HOST, PORT)
    return server

async def main():
    server = await start_server()
    # Keep server running
    await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{get_timestamp()} [Server] Server stopped by user.")

import os
import uuid
import json
import logging
import asyncio
import random
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Dict, List

# Load environment variables from .env if present
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    with open(env_path, "r") as f:
        for line in f:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                if "=" in stripped:
                    key, val = stripped.split("=", 1)
                    os.environ[key] = val

from backend.transmute import transmute_image_to_card, GameCard, CardStats
from backend.battle import BattleSession

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(title="Pocket Alchemy Backend")

# Enable CORS for frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In development, allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Request Schemas ---
class BattleCreateRequest(BaseModel):
    card_name: str
    is_pvp: bool = False
    image_url: str = ""

class BattleJoinRequest(BaseModel):
    lobby_id: str
    card_name: str
    image_url: str = ""

# --- Persistence Layer ---
CARDS_FILE = "cards_inventory.json"
uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(uploads_dir, exist_ok=True)

def load_inventory() -> List[Dict]:
    if os.path.exists(CARDS_FILE):
        try:
            with open(CARDS_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading inventory file: {e}")
            return []
    return []

def save_to_inventory(card: GameCard):
    inventory = load_inventory()
    inventory.append(card.model_dump())
    try:
        with open(CARDS_FILE, "w") as f:
            json.dump(inventory, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving to inventory file: {e}")

# In-memory battle sessions storage
battle_sessions: Dict[str, BattleSession] = {}

# --- REST Endpoints ---

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "gemini_api_configured": bool(os.environ.get("GEMINI_API_KEY"))}

@app.get("/api/cards", response_model=List[GameCard])
def get_cards():
    """Retrieve all transmuted cards in the player's forge inventory."""
    inventory = load_inventory()
    return [GameCard.model_validate(c) for c in inventory]

@app.post("/api/transmute", response_model=GameCard)
async def transmute(file: UploadFile = File(...)):
    """Receives a photo upload, transmutes it via Gemini, and saves it to inventory."""
    try:
        # Read file contents
        content = await file.read()
        
        # Save file locally for backup / image access
        file_ext = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        filepath = os.path.join(uploads_dir, unique_filename)
        
        with open(filepath, "wb") as f:
            f.write(content)
            
        logger.info(f"Saved uploaded file to {filepath}")
        
        # Transmute image to alchemical card
        card = await transmute_image_to_card(content, unique_filename)
        
        # Save local image path to card object
        card.image_url = f"/uploads/{unique_filename}"
        
        # Save to database
        save_to_inventory(card)
        
        return card
    except Exception as e:
        logger.error(f"Error during transmutation endpoint execution: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/battle/create")
def create_battle(request: BattleCreateRequest):
    """
    Creates a new battle session for a specific card in inventory.
    """
    card_name = request.card_name
    is_pvp = request.is_pvp
    image_url = request.image_url
    
    inventory = load_inventory()
    # Prefer exact match by image_url to avoid duplicate name collisions
    target_card_dict = None
    if image_url:
        target_card_dict = next((c for c in inventory if c.get("image_url") == image_url), None)
    if not target_card_dict:
        target_card_dict = next((c for c in inventory if c["card_name"] == card_name), None)
    
    if not target_card_dict:
        raise HTTPException(status_code=404, detail=f"Card '{card_name}' not found in inventory")
        
    player_card = GameCard.model_validate(target_card_dict)
    
    # Try selecting a random opponent from the inventory (excluding the player's card) if PvE
    opponent_card = None
    if not is_pvp:
        other_cards = [c for c in inventory if c["card_name"] != card_name]
        if other_cards:
            chosen_dict = random.choice(other_cards)
            opponent_card = GameCard.model_validate(chosen_dict)
            logger.info(f"Solo match: chose custom vault card opponent: {opponent_card.card_name}")
            
    lobby_id = str(uuid.uuid4())[:8] # short identifier
    
    # Create and register session
    session = BattleSession(lobby_id, player_card, is_pvp=is_pvp, opponent_card=opponent_card)
    battle_sessions[lobby_id] = session
    
    logger.info(f"Created battle lobby {lobby_id} (is_pvp={is_pvp}) for card {card_name}")
    return {
        "lobby_id": lobby_id, 
        "is_pvp": is_pvp,
        "boss_name": session.player2.card.card_name if not is_pvp else None
    }

@app.post("/api/battle/join")
def join_battle(request: BattleJoinRequest):
    """
    Joins an existing battle session as Player 2.
    """
    lobby_id = request.lobby_id
    card_name = request.card_name
    image_url = request.image_url
    
    session = battle_sessions.get(lobby_id)
    if not session:
        raise HTTPException(status_code=404, detail="Lobby not found")
        
    if not session.is_pvp:
        raise HTTPException(status_code=400, detail="Cannot join a solo match lobby")
        
    if session.player2 is not None:
        raise HTTPException(status_code=400, detail="Lobby is already full")
        
    inventory = load_inventory()
    # Prefer exact match by image_url
    target_card_dict = None
    if image_url:
        target_card_dict = next((c for c in inventory if c.get("image_url") == image_url), None)
    if not target_card_dict:
        target_card_dict = next((c for c in inventory if c["card_name"] == card_name), None)
    if not target_card_dict:
        raise HTTPException(status_code=404, detail=f"Card '{card_name}' not found in inventory")
        
    player_card = GameCard.model_validate(target_card_dict)
    session.join_opponent(player_card)
    
    logger.info(f"Player 2 joined battle lobby {lobby_id} with card {card_name}")
    return {"status": "success", "lobby_id": lobby_id}


# --- WebSockets Room & Battle Loop ---

@app.websocket("/ws/room/{lobby_id}/{client_id}")
async def websocket_room(websocket: WebSocket, lobby_id: str, client_id: str):
    session = battle_sessions.get(lobby_id)
    if not session:
        # If the room wasn't pre-created via REST, create a generic PvP room dynamically!
        # This makes it super resilient.
        # We initialize with a default empty card, and register their actual card on the first connect.
        session = BattleSession(lobby_id, None, is_pvp=True)
        battle_sessions[lobby_id] = session
        logger.info(f"Created dynamic PvP battle lobby {lobby_id} via WebSocket connection")

    await websocket.accept()
    logger.info(f"WebSocket client {client_id} connected to room {lobby_id}")
    
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            
            if action == "register":
                # Register the client's card to the lobby
                card_dict = data.get("card")
                if card_dict:
                    card = GameCard.model_validate(card_dict)
                    session.register_member(client_id, card, websocket)
                    logger.info(f"Registered card for client {client_id}: {card.card_name}")
                    await session.broadcast_state()
                    
            elif action == "challenge":
                target_id = data.get("target_id")
                if session.challenge_player(client_id, target_id):
                    # Notify target of the challenge
                    target_member = session.members.get(target_id)
                    if target_member:
                        await target_member["ws"].send_json({
                            "type": "challenge_received",
                            "from_id": client_id,
                            "from_name": session.members[client_id]["card"].card_name if session.members[client_id]["card"] else "Unknown"
                        })
                    await session.broadcast_state()

            elif action == "accept_challenge":
                from_id = data.get("from_id")
                if session.accept_challenge(client_id, from_id):
                    logger.info(f"Challenge accepted in room {lobby_id}: {from_id} vs {client_id}")
                    await session.broadcast_state()

            elif action == "decline_challenge":
                session.reset_lobby_status()
                await session.broadcast_state()

            elif action == "battle_action":
                combat_move = data.get("combat_move") # "attack" or "ability"
                if session.is_pvp and client_id != session.player1_id and client_id != session.player2_id:
                    await websocket.send_json({"type": "error", "message": "You are spectating, not fighting."})
                    continue
                
                ready = session.select_action(client_id, combat_move)
                await session.broadcast_state()
                
                if ready:
                    await asyncio.sleep(0.5)
                    session.execute_round()
                    await session.broadcast_state()

            elif action == "exit_battle":
                session.reset_lobby_status()
                session.game_over = False
                session.winner = ""
                session.round_number = 1
                session.player1_action = None
                session.player2_action = None
                await session.broadcast_state()

    except WebSocketDisconnect:
        logger.info(f"WebSocket client {client_id} disconnected from room {lobby_id}")
    finally:
        if session:
            session.remove_member(client_id)
            await session.broadcast_state()
            
            # Delete lobby if empty
            if not session.members and lobby_id in battle_sessions:
                del battle_sessions[lobby_id]
                logger.info(f"Deleted lobby {lobby_id} due to no active members")

# Serve uploaded images statically
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# Serve compiled static assets
dist_assets_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "../frontend/dist/assets"))
if os.path.exists(dist_assets_dir):
    app.mount("/assets", StaticFiles(directory=dist_assets_dir), name="assets")

# Serve index.html at root
@app.get("/")
def read_index():
    dist_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "../frontend/dist"))
    index_file = os.path.join(dist_dir, "index.html")
    if os.path.exists(index_file):
        from fastapi.responses import FileResponse
        return FileResponse(index_file)
    return {"message": "Pocket Alchemy Backend Active. Serve frontend dist folder by compiling Vite."}

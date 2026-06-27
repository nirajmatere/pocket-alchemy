import os
import uuid
import json
import logging
import asyncio
import random
import datetime
import re
import hashlib
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Dict, List, Any

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

# Robustly resolve GOOGLE_APPLICATION_CREDENTIALS to an absolute path
gac = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
if gac and not os.path.isabs(gac):
    possible_paths = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", gac)),
        os.path.abspath(os.path.join(os.path.dirname(__file__), gac)),
        os.path.abspath(gac)
    ]
    for p in possible_paths:
        if os.path.exists(p):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = p
            break


from backend.transmute import transmute_image_to_card, fuse_cards, GameCard, CardStats
from backend.battle import BattleSession, CAMPAIGN_BOSSES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

# --- Managed Agents Helper ---

def get_or_create_agent(client, agent_id: str, system_instruction: str, base_agent: str = "antigravity-preview-05-2026"):
    try:
        agent = client.agents.get(id=agent_id)
        logger.info(f"Managed Agent {agent_id} already exists.")
        return agent
    except Exception:
        try:
            logger.info(f"Managed Agent {agent_id} not found. Creating a new one...")
            agent = client.agents.create(
                id=agent_id,
                base_agent=base_agent,
                system_instruction=system_instruction
            )
            logger.info(f"Successfully created Managed Agent {agent_id}.")
            return agent
        except Exception as e:
            logger.warning(f"Failed to create Managed Agent {agent_id}: {e}. Will use direct prompt interaction fallback.")
            return None

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
    client_id: str = "local_user"
    card_name: str
    is_pvp: bool = False
    image_url: str = ""
    opponent_card: GameCard | None = None

class BattleJoinRequest(BaseModel):
    client_id: str = "local_user"
    lobby_id: str
    card_name: str
    image_url: str = ""

class CampaignFightRequest(BaseModel):
    client_id: str
    card_name: str
    image_url: str = ""
    stage: int

class FuseRequest(BaseModel):
    client_id: str
    card1_name: str
    card1_image_url: str
    card2_name: str
    card2_image_url: str

# --- Hybrid Database Layer (Firestore with local JSON fallbacks) ---

class AlchemicalDB:
    def __init__(self):
        self.firestore_db = None
        self.local_cards_file = "cards_inventory.json"
        self.local_profile_file = "player_profile.json"
        self.local_leaderboard_file = "uniqueness_leaderboard.json"
        
        # Try initializing Firestore
        try:
            from google.cloud import firestore
            project_id = os.environ.get("GCP_PROJECT_ID")
            if project_id:
                self.firestore_db = firestore.Client(project=project_id)
            else:
                self.firestore_db = firestore.Client()
            logger.info("Successfully initialized Cloud Firestore.")
        except Exception as e:
            logger.warning(f"Could not initialize Google Cloud Firestore: {e}. Falling back to local JSON stores.")

    def get_inventory(self, client_id: str) -> List[Dict]:
        if self.firestore_db:
            try:
                doc_ref = self.firestore_db.collection("users").document(client_id)
                doc = doc_ref.get()
                if doc.exists:
                    return doc.to_dict().get("inventory", [])
                return []
            except Exception as e:
                logger.error(f"Firestore get_inventory error: {e}")
                
        # Local fallback
        if os.path.exists(self.local_cards_file):
            try:
                with open(self.local_cards_file, "r") as f:
                    all_cards = json.load(f)
                    return [c for c in all_cards if c.get("creator_id", "local_user") == client_id]
            except Exception as e:
                logger.error(f"Local inventory load error: {e}")
        return []

    def save_card(self, client_id: str, card: GameCard):
        card_dict = card.model_dump()
        if self.firestore_db:
            try:
                from google.cloud import firestore
                doc_ref = self.firestore_db.collection("users").document(client_id)
                doc = doc_ref.get()
                if doc.exists:
                    doc_ref.update({
                        "inventory": firestore.ArrayUnion([card_dict])
                    })
                else:
                    doc_ref.set({
                        "inventory": [card_dict]
                    })
                logger.info(f"Card saved to Firestore for user {client_id}")
                return
            except Exception as e:
                logger.error(f"Firestore save_card error: {e}")

        # Local fallback
        all_cards = []
        if os.path.exists(self.local_cards_file):
            try:
                with open(self.local_cards_file, "r") as f:
                    all_cards = json.load(f)
            except Exception as e:
                logger.error(f"Local inventory load error: {e}")
        
        card_dict["creator_id"] = client_id
        all_cards.append(card_dict)
        try:
            with open(self.local_cards_file, "w") as f:
                json.dump(all_cards, f, indent=2)
            logger.info("Card saved to local inventory file.")
        except Exception as e:
            logger.error(f"Local card save error: {e}")

    def get_profile(self, client_id: str) -> Dict:
        default_profile = {
            "level": 1,
            "experience": 0,
            "aether_dust": 200,
            "catalysts": 2,
            "unlocked_campaign_stage": 1,
            "badges": []
        }
        if self.firestore_db:
            try:
                doc_ref = self.firestore_db.collection("users").document(client_id).collection("profile").document("stats")
                doc = doc_ref.get()
                if doc.exists:
                    return doc.to_dict()
                else:
                    doc_ref.set(default_profile)
                    return default_profile
            except Exception as e:
                logger.error(f"Firestore get_profile error: {e}")

        # Local fallback
        if os.path.exists(self.local_profile_file):
            try:
                with open(self.local_profile_file, "r") as f:
                    all_profiles = json.load(f)
                    return all_profiles.get(client_id, default_profile)
            except Exception as e:
                logger.error(f"Local profile load error: {e}")
        return default_profile

    def update_profile(self, client_id: str, updates: Dict):
        profile = self.get_profile(client_id)
        profile.update(updates)
        
        if self.firestore_db:
            try:
                doc_ref = self.firestore_db.collection("users").document(client_id).collection("profile").document("stats")
                doc_ref.set(profile)
                logger.info(f"Profile updated in Firestore for user {client_id}")
                return
            except Exception as e:
                logger.error(f"Firestore update_profile error: {e}")

        # Local fallback
        all_profiles = {}
        if os.path.exists(self.local_profile_file):
            try:
                with open(self.local_profile_file, "r") as f:
                    all_profiles = json.load(f)
            except Exception:
                pass
        all_profiles[client_id] = profile
        try:
            with open(self.local_profile_file, "w") as f:
                json.dump(all_profiles, f, indent=2)
            logger.info("Profile saved to local profile file.")
        except Exception as e:
            logger.error(f"Local profile update error: {e}")

    def get_leaderboard(self) -> List[Dict]:
        if self.firestore_db:
            try:
                from google.cloud import firestore
                cards_ref = self.firestore_db.collection("uniqueness_leaderboard")
                query = cards_ref.order_by("uniqueness_score", direction=firestore.Query.DESCENDING).limit(20)
                results = []
                for doc in query.stream():
                    results.append(doc.to_dict())
                return results
            except Exception as e:
                logger.error(f"Firestore get_leaderboard error: {e}")

        # Local fallback
        if os.path.exists(self.local_leaderboard_file):
            try:
                with open(self.local_leaderboard_file, "r") as f:
                    leaderboard = json.load(f)
                    leaderboard.sort(key=lambda x: x.get("uniqueness_score", 0), reverse=True)
                    return leaderboard[:20]
            except Exception as e:
                logger.error(f"Local leaderboard load error: {e}")
        return []

    def submit_to_leaderboard(self, card: GameCard, client_id: str):
        card_dict = card.model_dump()
        card_dict["creator_id"] = client_id
        
        if self.firestore_db:
            try:
                doc_ref = self.firestore_db.collection("uniqueness_leaderboard").document(card.card_name)
                doc_ref.set(card_dict)
                logger.info(f"Submitted {card.card_name} to Firestore leaderboard.")
                return
            except Exception as e:
                logger.error(f"Firestore submit_to_leaderboard error: {e}")

        # Local fallback — read the full file (not the capped getter) so no cards are dropped
        all_entries = []
        if os.path.exists(self.local_leaderboard_file):
            try:
                with open(self.local_leaderboard_file, "r") as f:
                    all_entries = json.load(f)
            except Exception as e:
                logger.error(f"Local leaderboard read error: {e}")
        all_entries = [x for x in all_entries if x.get("card_name") != card.card_name or x.get("creator_id") != client_id]
        all_entries.append(card_dict)
        try:
            with open(self.local_leaderboard_file, "w") as f:
                json.dump(all_entries, f, indent=2)
            logger.info("Submitted to local leaderboard file.")
        except Exception as e:
            logger.error(f"Local leaderboard submit error: {e}")

    def get_battle_history(self) -> List[Dict]:
        if self.firestore_db:
            try:
                from google.cloud import firestore
                history_ref = self.firestore_db.collection("battle_history")
                query = history_ref.order_by("timestamp", direction=firestore.Query.DESCENDING).limit(10)
                results = []
                for doc in query.stream():
                    results.append(doc.to_dict())
                return results
            except Exception as e:
                logger.error(f"Firestore get_battle_history error: {e}")
        
        # Local fallback
        history_file = "battle_history.json"
        if os.path.exists(history_file):
            try:
                with open(history_file, "r") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Local history load error: {e}")
        return []

    def log_battle(self, winner: str, loser: str, mode: str, rounds: int):
        battle_dict = {
            "winner": winner,
            "loser": loser,
            "mode": mode,
            "rounds": rounds,
            "timestamp": datetime.datetime.now().isoformat()
        }
        if self.firestore_db:
            try:
                self.firestore_db.collection("battle_history").add(battle_dict)
                return
            except Exception as e:
                logger.error(f"Firestore log_battle error: {e}")
        
        # Local fallback
        history = self.get_battle_history()
        history.insert(0, battle_dict)
        history = history[:10]  # keep last 10
        try:
            with open("battle_history.json", "w") as f:
                json.dump(history, f, indent=2)
            logger.info("Logged battle to local history.")
        except Exception as e:
            logger.error(f"Local battle history write error: {e}")

# Initialize database repository
db_client = AlchemicalDB()

uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(uploads_dir, exist_ok=True)

# In-memory battle sessions storage
battle_sessions: Dict[str, BattleSession] = {}

# --- Google Cloud Storage (GCS) Helper ---

def upload_to_gcs(content: bytes, filename: str) -> str | None:
    bucket_name = os.environ.get("GCS_BUCKET_NAME")
    if not bucket_name:
        return None
    try:
        from google.cloud import storage
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(filename)
        blob.upload_from_string(content, content_type="image/jpeg")
        try:
            blob.make_public()
            return blob.public_url
        except Exception:
            return f"https://storage.googleapis.com/{bucket_name}/{filename}"
    except Exception as e:
        logger.error(f"Failed to upload to GCS: {e}")
        return None

# --- Google Vision API SafeSearch Middleware ---

def check_safe_search(image_bytes: bytes) -> bool:
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        return True
    try:
        from google.cloud import vision
        client = vision.ImageAnnotatorClient()
        image = vision.Image(content=image_bytes)
        response = client.safe_search_detection(image=image)
        safe = response.safe_search_annotation
        
        unsafe_tiers = ["LIKELY", "VERY_LIKELY"]
        if (safe.adult.name in unsafe_tiers or 
            safe.medical.name in unsafe_tiers or 
            safe.violence.name in unsafe_tiers or 
            safe.racy.name in unsafe_tiers):
            logger.warning(f"Vision API SafeSearch blocked image. adult={safe.adult.name}, violence={safe.violence.name}, racy={safe.racy.name}")
            return False
        return True
    except Exception as e:
        logger.error(f"SafeSearch check failed: {e}. Defaulting to safe.")
        return True

# --- Daily Quests Helper ---

def get_current_daily_quest() -> Dict:
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    quests = [
        {"quest_id": "q1", "element": "Fire", "description": "Forge a FIRE card (1.5x Uniqueness score bonus!)"},
        {"quest_id": "q2", "element": "Lightning", "description": "Forge a LIGHTNING card (1.5x Uniqueness score bonus!)"},
        {"quest_id": "q3", "element": "Water", "description": "Forge a WATER card (1.5x Uniqueness score bonus!)"},
        {"quest_id": "q4", "element": "Earth", "description": "Forge an EARTH card (1.5x Uniqueness score bonus!)"},
        {"quest_id": "q5", "sub_element": "Plasma", "description": "Forge a PLASMA card (1.5x Uniqueness score bonus!)"}
    ]
    idx = int(hashlib.md5(today_str.encode()).hexdigest(), 16) % len(quests)
    return quests[idx]

# --- REST Endpoints ---

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "gemini_api_configured": bool(os.environ.get("GEMINI_API_KEY"))}

@app.get("/api/cards", response_model=List[GameCard])
def get_cards(client_id: str = "local_user"):
    """Retrieve all transmuted cards in the player's forge inventory."""
    inventory = db_client.get_inventory(client_id)
    # Reverse to return latest captures first
    reversed_inventory = list(reversed(inventory))
    return [GameCard.model_validate(c) for c in reversed_inventory]

@app.post("/api/transmute", response_model=GameCard)
async def transmute(file: UploadFile = File(...), client_id: str = Form("local_user")):
    """Receives a photo upload, verifies via SafeSearch, transmutes via Gemini, and saves to inventory."""
    try:
        content = await file.read()
        
        # SafeSearch check
        if not check_safe_search(content):
            raise HTTPException(status_code=400, detail="SafeSearch Filter blocked this image: contains unsafe content.")
        
        # Save file locally for backup / image access
        file_ext = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        filepath = os.path.join(uploads_dir, unique_filename)
        
        with open(filepath, "wb") as f:
            f.write(content)
            
        logger.info(f"Saved uploaded file to {filepath}")
        
        # Upload to Google Cloud Storage if configured
        gcs_url = upload_to_gcs(content, unique_filename)
        
        # Transmute image to alchemical card
        mime_type = file.content_type if file.content_type else "image/jpeg"
        card = await transmute_image_to_card(content, unique_filename, mime_type)
        card.image_url = gcs_url if gcs_url else f"/uploads/{unique_filename}"
        
        from datetime import datetime
        card.created_date = datetime.utcnow().strftime("%Y-%m-%d")
        
        # Upload Imagen artwork to GCS if generated locally
        if card.image_art_url and card.image_art_url.startswith("/uploads/"):
            art_local_filename = card.image_art_url.split("/")[-1]
            art_local_path = os.path.join(uploads_dir, art_local_filename)
            if os.path.exists(art_local_path):
                with open(art_local_path, "rb") as af:
                    art_content = af.read()
                gcs_art_url = upload_to_gcs(art_content, art_local_filename)
                if gcs_art_url:
                    card.image_art_url = gcs_art_url
        
        # Apply Daily Quest Multiplier
        quest = get_current_daily_quest()
        matches_quest = False
        if "element" in quest and card.element.lower() == quest["element"].lower():
            matches_quest = True
        elif "sub_element" in quest and card.sub_element.lower() == quest["sub_element"].lower():
            matches_quest = True
            
        if matches_quest:
            card.uniqueness_score = min(100, int(card.uniqueness_score * 1.5))
            card.uniqueness_reason = f"✨ [Daily Quest Bonus!] {card.uniqueness_reason}"
        
        # Submit to daily leaderboard
        db_client.submit_to_leaderboard(card, client_id)
        
        # Save to database
        db_client.save_card(client_id, card)
        
        return card
    except Exception as e:
        logger.error(f"Error during transmutation endpoint execution: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cards/fuse", response_model=GameCard)
async def fuse(request: FuseRequest):
    """Blends two GameCards using alchemical fusion rules."""
    profile = db_client.get_profile(request.client_id)
    if profile.get("catalysts", 0) < 1:
        raise HTTPException(status_code=400, detail="Insufficient Fusion Catalysts! Win battles to earn more.")
        
    inventory = db_client.get_inventory(request.client_id)
    card1_dict = next((c for c in inventory if c["card_name"] == request.card1_name and c.get("image_url") == request.card1_image_url), None)
    card2_dict = next((c for c in inventory if c["card_name"] == request.card2_name and c.get("image_url") == request.card2_image_url), None)
    
    if not card1_dict or not card2_dict:
        raise HTTPException(status_code=404, detail="One or both parent cards not found in inventory.")
        
    card1 = GameCard.model_validate(card1_dict)
    card2 = GameCard.model_validate(card2_dict)
    
    seed = str(uuid.uuid4())[:8]
    fused = await fuse_cards(card1, card2, seed)
    
    from datetime import datetime
    fused.created_date = datetime.utcnow().strftime("%Y-%m-%d")
    db_client.submit_to_leaderboard(fused, request.client_id)
    
    # Upload fused art to GCS if generated locally
    if fused.image_art_url and fused.image_art_url.startswith("/uploads/"):
        art_local_filename = fused.image_art_url.split("/")[-1]
        art_local_path = os.path.join(uploads_dir, art_local_filename)
        if os.path.exists(art_local_path):
            with open(art_local_path, "rb") as af:
                art_content = af.read()
            gcs_art_url = upload_to_gcs(art_content, art_local_filename)
            if gcs_art_url:
                fused.image_art_url = gcs_art_url

    # Save fused card
    db_client.save_card(request.client_id, fused)
    
    # Deduct catalyst
    profile["catalysts"] -= 1
    db_client.update_profile(request.client_id, profile)
    
    return fused

@app.get("/api/campaign/status")
def get_campaign_status(client_id: str = "local_user"):
    """Fetches user profile status containing stage progression, dust, catalysts, and badges."""
    return db_client.get_profile(client_id)

@app.post("/api/campaign/fight")
def campaign_fight(request: CampaignFightRequest):
    """Initializes a PvE battle session against a campaign stage boss."""
    inventory = db_client.get_inventory(request.client_id)
    target_card_dict = next((c for c in inventory if c["card_name"] == request.card_name and c.get("image_url") == request.image_url), None)
    if not target_card_dict:
        target_card_dict = next((c for c in inventory if c["card_name"] == request.card_name), None)
    if not target_card_dict:
        raise HTTPException(status_code=404, detail="Card not found in inventory.")
        
    player_card = GameCard.model_validate(target_card_dict)
    lobby_id = f"C_{str(uuid.uuid4())[:6].upper()}"
    
    session = BattleSession(lobby_id, player_card, is_pvp=False, campaign_stage=request.stage)
    battle_sessions[lobby_id] = session
    
    return {
        "lobby_id": lobby_id,
        "boss_name": session.player2.card.card_name
    }

@app.get("/api/dashboard/uniqueness")
def get_uniqueness_dashboard(client_id: str = "local_user"):
    """Fetches global uniqueness leaderboard, active daily quest details, user badges profile, and recent battle history."""
    leaderboard = db_client.get_leaderboard()
    quest = get_current_daily_quest()
    profile = db_client.get_profile(client_id)
    battle_history = db_client.get_battle_history()
    return {
        "leaderboard": leaderboard,
        "daily_quest": quest,
        "profile": profile,
        "battle_history": battle_history
    }

class HintRequest(BaseModel):
    client_id: str
    lobby_id: str

@app.post("/api/battle/hint")
async def get_battle_hint(request: HintRequest):
    """Spend 15 Aether Dust for a Gemini-powered tactical hint."""
    profile = db_client.get_profile(request.client_id)
    if profile.get("aether_dust", 0) < 15:
        raise HTTPException(status_code=400, detail="Insufficient Aether Dust! Need 15 to consult Chronos.")
    
    session = battle_sessions.get(request.lobby_id)
    if not session or not session.player1 or not session.player2:
        raise HTTPException(status_code=404, detail="No active battle found.")
    
    p1 = session.player1
    p2 = session.player2
    
    hint_prompt = (
        f"You are Chronos, a wise alchemical battle advisor in a card game. "
        f"Give ONE short tactical sentence (max 20 words) for this scenario:\n"
        f"My card: {p1.card.card_name} (Element: {p1.card.element}, HP: {p1.current_health}/{p1.max_health}, "
        f"ATK: {p1.attack + p1.attack_buff}, SPD: {p1.speed + p1.speed_buff}, "
        f"Ability: {p1.card.ability_name} [{p1.card.effect_type}, value {p1.card.value}], "
        f"Cooldown: {p1.ability_cooldown} rounds, Shield: {p1.shield_active})\n"
        f"Enemy card: {p2.card.card_name} (Element: {p2.card.element}, HP: {p2.current_health}/{p2.max_health}, "
        f"ATK: {p2.attack + p2.attack_buff}, SPD: {p2.speed + p2.speed_buff}, "
        f"Shield: {p2.shield_active})\n"
        f"Round: {session.round_number}. Stances available: aggressive (1.2x dmg), defensive (reduce dmg), focused (fast cooldown).\n"
        f"Respond with ONLY the hint, no preamble."
    )
    
    try:
        from google import genai
        project_id = os.environ.get("GCP_PROJECT_ID")
        location = os.environ.get("GCP_LOCATION", "asia-northeast1")
        api_key = os.environ.get("GEMINI_API_KEY")
        
        if project_id:
            client = genai.Client(vertexai=True, project=project_id, location=location)
        elif api_key:
            client = genai.Client(api_key=api_key)
        else:
            raise HTTPException(status_code=500, detail="Neither GCP_PROJECT_ID nor GEMINI_API_KEY is configured.")
            
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=hint_prompt
        )
        hint_text = response.text.strip()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Gemini hint generation failed: {e}")
        # Fallback hint
        hints = [
            f"Use aggressive stance with attack — {p2.card.card_name}'s shield is {'up' if p2.shield_active else 'down'}!",
            f"Switch to defensive stance. Outlast {p2.card.card_name} and wait for your ability cooldown.",
            f"Go focused to reduce your ability cooldown faster, then unleash {p1.card.ability_name}!",
        ]
        hint_text = random.choice(hints)
    
    # Deduct dust
    profile["aether_dust"] = profile.get("aether_dust", 0) - 15
    db_client.update_profile(request.client_id, profile)
    
    return {"hint": hint_text, "remaining_dust": profile["aether_dust"]}

class AgentPlayRequest(BaseModel):
    client_id: str
    lobby_id: str

class GeminiAgentDecision(BaseModel):
    action: str = Field(description="Combat move: 'attack' or 'ability'. Must choose 'attack' if my_ability_cooldown > 0.")
    stance: str = Field(description="Tactical stance: 'aggressive', 'defensive', or 'focused'.")
    reasoning: str = Field(description="A short, tactical description of why this choice was made (max 15 words).")

@app.post("/api/battle/agent_play")
async def battle_agent_play(request: AgentPlayRequest):
    """Deploys a Gemini-powered Managed Battle Agent to choose the best stance and action."""
    session = battle_sessions.get(request.lobby_id)
    if not session or not session.player1 or not session.player2:
        raise HTTPException(status_code=404, detail="No active battle found.")
    
    # Identify player index
    if session.is_pvp:
        if request.client_id == session.player1_id:
            me = session.player1
            opp = session.player2
            my_id = session.player1_id
        elif request.client_id == session.player2_id:
            me = session.player2
            opp = session.player1
            my_id = session.player2_id
        else:
            raise HTTPException(status_code=400, detail="Client is not a participant in this PvP match.")
    else:
        # Solo / Campaign matches
        me = session.player1
        opp = session.player2
        my_id = request.client_id

    # Construct prompt
    prompt = (
        f"You are the Managed Battle Agent for {me.card.card_name} in an alchemical card battler.\n"
        f"Analyze the current state and choose the absolute best tactical action and stance.\n\n"
        f"MY STATE:\n"
        f"- Name: {me.card.card_name}\n"
        f"- Element: {me.card.element} (Sub: {me.card.sub_element})\n"
        f"- Health: {me.current_health}/{me.max_health}\n"
        f"- ATK: {me.attack + me.attack_buff}\n"
        f"- SPD: {me.speed + me.speed_buff}\n"
        f"- Special Ability: {me.card.ability_name} (Effect: {me.card.effect_type}, Power: {me.card.value})\n"
        f"- Ability Cooldown: {me.ability_cooldown} rounds (Can only use 'ability' if cooldown is 0)\n"
        f"- Shield Active: {me.shield_active}\n"
        f"- Current Stance: {me.stance}\n\n"
        f"OPPONENT STATE:\n"
        f"- Name: {opp.card.card_name}\n"
        f"- Element: {opp.card.element} (Sub: {opp.card.sub_element})\n"
        f"- Health: {opp.current_health}/{opp.max_health}\n"
        f"- ATK: {opp.attack + opp.attack_buff}\n"
        f"- SPD: {opp.speed + opp.speed_buff}\n"
        f"- Shield Active: {opp.shield_active}\n"
        f"- Current Stance: {opp.stance}\n\n"
        f"TACTICAL RULES:\n"
        f"1. Element Matchups: Fire beats Earth, Earth beats Lightning, Lightning beats Water, Water beats Fire (1.5x damage). Inverse is 0.7x damage.\n"
        f"2. Aggressive stance: Increases attack damage by 1.2x, but reduces speed by 0.9x.\n"
        f"3. Defensive stance: Reduces incoming damage by flat 15 points, but reduces attack damage by 0.8x.\n"
        f"4. Focused stance: Reduces special ability cooldown twice as fast (2 per turn) and increases speed by 1.25x.\n"
        f"5. If my ability cooldown is > 0, you MUST select 'attack' as the action.\n\n"
        f"Choose stance ('aggressive', 'defensive', 'focused') and action ('attack', 'ability') and output in JSON matching the schema."
    )

    try:
        from google import genai
        from google.genai import types
        project_id = os.environ.get("GCP_PROJECT_ID")
        location = os.environ.get("GCP_LOCATION", "asia-northeast1")
        api_key = os.environ.get("GEMINI_API_KEY")
        
        if project_id:
            client = genai.Client(vertexai=True, project=project_id, location=location)
        elif api_key:
            client = genai.Client(api_key=api_key)
        else:
            raise HTTPException(status_code=500, detail="Neither GCP_PROJECT_ID nor GEMINI_API_KEY is configured.")
            
        # Try utilizing the Managed Agents API
        try:
            agent_id = "combat-tactician-agent"
            get_or_create_agent(
                client, 
                agent_id=agent_id,
                system_instruction=(
                    "You are a tactical combat agent that makes battle decisions for a trading card game. "
                    "You evaluate stats, cooldowns, stances, and element matchups to select the optimal move. "
                    "You must output ONLY a JSON object matching the requested schema. Do not output markdown code blocks."
                )
            )
            
            logger.info(f"Invoking Managed Agent {agent_id} for combat decision...")
            interaction = client.interactions.create(
                agent=agent_id,
                input=prompt,
                environment="remote"
            )
            raw_text = interaction.output_text
            
            # Clean text if wrapped in ```json or ```
            if "```json" in raw_text:
                raw_text = raw_text.split("```json")[1].split("```")[0].strip()
            elif "```" in raw_text:
                raw_text = raw_text.split("```")[1].split("```")[0].strip()
            else:
                raw_text = raw_text.strip()
                
            decision = GeminiAgentDecision.model_validate_json(raw_text)
            action = decision.action.lower()
            stance = decision.stance.lower()
            reasoning = decision.reasoning
        except Exception as agent_err:
            logger.warning(f"Managed Agents API failed: {agent_err}. Falling back to standard generate_content.")
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=GeminiAgentDecision,
                    temperature=0.1
                )
            )
            decision = GeminiAgentDecision.model_validate_json(response.text)
            action = decision.action.lower()
            stance = decision.stance.lower()
            reasoning = decision.reasoning
        
        # Double check constraints (fallback logic)
        if action not in ["attack", "ability"]:
            action = "attack"
        if me.ability_cooldown > 0:
            action = "attack"
        if stance not in ["aggressive", "defensive", "focused"]:
            stance = "focused"
            
    except Exception as e:
        logger.error(f"Managed Battle Agent API call failed: {e}. Falling back to default heuristics.")
        # Default heuristics
        if me.ability_cooldown == 0:
            action = "ability"
        else:
            action = "attack"
        
        if me.current_health < me.max_health * 0.3:
            stance = "defensive"
        elif opp.shield_active:
            stance = "focused"
        else:
            stance = "aggressive"
        reasoning = "System fallback: standard defensive/offensive heuristic triggered."

    # Execute action lock
    ready = session.select_action(my_id, action, stance)
    
    # Log the decision to the combat logs
    session.combat_logs.append(f"🤖 [Managed Agent] Decision: {me.card.card_name} switches to {stance.upper()} stance and prepares {action.upper()}.")
    session.combat_logs.append(f"🤖 [Managed Agent] Analysis: {reasoning}")
    
    await session.broadcast_state()
    
    if ready:
        await asyncio.sleep(0.5)
        session.execute_round()
        await session.broadcast_state()

    return {
        "action": action,
        "stance": stance,
        "reasoning": reasoning
    }

class AdvisorChatRequest(BaseModel):
    client_id: str
    message: str
    chat_history: List[Dict[str, str]] = []

@app.post("/api/advisor/chat")
async def advisor_chat(request: AdvisorChatRequest):
    """Chat with the Managed Alchemical Sage Agent to get deck advice and fusion strategies."""
    project_id = os.environ.get("GCP_PROJECT_ID")
    location = os.environ.get("GCP_LOCATION", "asia-northeast1")
    api_key = os.environ.get("GEMINI_API_KEY")
    
    # Load user's cards to provide as context to the agent
    inventory = db_client.get_inventory(request.client_id)
    cards_summary = []
    for c in inventory:
        cards_summary.append(
            f"- {c['card_name']} (Element: {c['element']}, Sub: {c.get('sub_element', 'Aether')}, HP: {c['base_stats']['health']}, ATK: {c['base_stats']['attack']}, SPD: {c['base_stats']['speed']}, Ability: {c['ability_name']}, Lore: {c['lore']})"
        )
    cards_context = "\n".join(cards_summary) if cards_summary else "No cards forged yet."
    
    system_instruction = (
        "You are the Alchemical Sage, an ancient master of deck building, combat strategy, and lore in the game 'Pocket Alchemy'.\n"
        "Your role is to guide players to optimize their decks, suggest which cards to fuse, explain battle strategy, and recount alchemical lore.\n\n"
        "Here is the player's current card inventory:\n"
        f"{cards_context}\n\n"
        "Guidelines:\n"
        "1. Be wise, slightly mysterious, and encouraging, like a high-tech cyberpunk alchemist mentor.\n"
        "2. When suggesting fusions, recommend two specific cards from their inventory and explain what powerful hybrid would emerge (e.g., combining Fire and Water for Steam/Vapor, or Lightning and Earth for Quartz).\n"
        "3. Keep responses relatively concise but filled with thematic alchemical terms."
    )
    
    try:
        from google import genai
        from google.genai import types
        
        if project_id:
            client = genai.Client(vertexai=True, project=project_id, location=location)
        elif api_key:
            client = genai.Client(api_key=api_key)
        else:
            raise HTTPException(status_code=500, detail="Neither GCP_PROJECT_ID nor GEMINI_API_KEY is configured.")
            
        # Try utilizing the Managed Agents API
        try:
            agent_id = "alchemical-sage-advisor"
            get_or_create_agent(
                client,
                agent_id=agent_id,
                system_instruction=system_instruction
            )
            
            logger.info(f"Invoking Managed Agent {agent_id} for advisor chat...")
            interaction = client.interactions.create(
                agent=agent_id,
                input=request.message,
                environment="remote"
            )
            response_text = interaction.output_text
            
        except Exception as agent_err:
            logger.warning(f"Managed Agents API failed: {agent_err}. Falling back to standard generate_content.")
            # Fallback to standard generate_content using gemini-2.5-flash
            messages = [
                types.Content(role="user", parts=[types.Part.from_text(text=f"System Instruction: {system_instruction}")]),
                types.Content(role="model", parts=[types.Part.from_text(text="I am ready to advise you, apprentice.")])
            ]
            for h in request.chat_history:
                messages.append(types.Content(
                    role="user" if h["role"] == "user" else "model",
                    parts=[types.Part.from_text(text=h["text"])]
                ))
            messages.append(types.Content(role="user", parts=[types.Part.from_text(text=request.message)]))
            
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=messages
            )
            response_text = resp.text
            
        return {"response": response_text}
    except Exception as e:
        logger.error(f"Advisor Chat failed: {e}")
        return {"response": "The alchemical channels are unstable at the moment. Try again later, apprentice."}

@app.post("/api/battle/create")
def create_battle(request: BattleCreateRequest):
    """Creates a new battle session for a specific card in inventory."""
    card_name = request.card_name
    is_pvp = request.is_pvp
    image_url = request.image_url
    client_id = request.client_id
    
    inventory = db_client.get_inventory(client_id)
    target_card_dict = None
    if image_url:
        target_card_dict = next((c for c in inventory if c.get("image_url") == image_url), None)
    if not target_card_dict:
        target_card_dict = next((c for c in inventory if c["card_name"] == card_name), None)
    
    if not target_card_dict:
        raise HTTPException(status_code=404, detail=f"Card '{card_name}' not found in inventory")
        
    player_card = GameCard.model_validate(target_card_dict)
    
    opponent_card = None
    if not is_pvp:
        if request.opponent_card:
            opponent_card = request.opponent_card
        else:
            other_cards = [c for c in inventory if c["card_name"] != card_name]
            if other_cards:
                chosen_dict = random.choice(other_cards)
                opponent_card = GameCard.model_validate(chosen_dict)
            
    lobby_id = str(uuid.uuid4())[:8].upper()

    session = BattleSession(lobby_id, player_card, is_pvp=is_pvp, opponent_card=opponent_card)
    battle_sessions[lobby_id] = session

    return {
        "lobby_id": lobby_id,
        "is_pvp": is_pvp,
        "boss_name": session.player2.card.card_name if not is_pvp else None
    }

@app.post("/api/battle/join")
def join_battle(request: BattleJoinRequest):
    """Joins an existing battle session as Player 2."""
    lobby_id = request.lobby_id
    card_name = request.card_name
    image_url = request.image_url
    client_id = request.client_id
    
    session = battle_sessions.get(lobby_id)
    if not session:
        raise HTTPException(status_code=404, detail="Lobby not found")
    if not session.is_pvp:
        raise HTTPException(status_code=400, detail="Cannot join a solo match lobby")
    if session.player2 is not None:
        raise HTTPException(status_code=400, detail="Lobby is already full")
        
    inventory = db_client.get_inventory(client_id)
    target_card_dict = None
    if image_url:
        target_card_dict = next((c for c in inventory if c.get("image_url") == image_url), None)
    if not target_card_dict:
        target_card_dict = next((c for c in inventory if c["card_name"] == card_name), None)
    if not target_card_dict:
        raise HTTPException(status_code=404, detail=f"Card '{card_name}' not found in inventory")
        
    player_card = GameCard.model_validate(target_card_dict)
    session.join_opponent(player_card)
    
    return {"status": "success", "lobby_id": lobby_id}

# --- WebSockets Room & Battle Loop ---

@app.websocket("/ws/room/{lobby_id}/{client_id}")
async def websocket_room(websocket: WebSocket, lobby_id: str, client_id: str):
    lobby_id = lobby_id.upper()
    session = battle_sessions.get(lobby_id)
    if not session:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": f"Room '{lobby_id}' not found. Please check the code and try again."})
        await websocket.close()
        return

    await websocket.accept()
    
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")
            
            if action == "register":
                card_dict = data.get("card")
                card = GameCard.model_validate(card_dict) if card_dict else None
                session.register_member(client_id, card, websocket)
                await session.broadcast_state()
                    
            elif action == "challenge":
                target_id = data.get("target_id")
                if session.challenge_player(client_id, target_id):
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
                    await session.broadcast_state()

            elif action == "decline_challenge":
                session.reset_lobby_status()
                await session.broadcast_state()

            elif action == "start_tournament":
                if client_id == session.owner_id:
                    session.start_tournament()
                    await session.broadcast_state()

            elif action == "reset_tournament":
                if client_id == session.owner_id:
                    session.reset_tournament()
                    await session.broadcast_state()

            elif action == "battle_action":
                combat_move = data.get("combat_move")
                stance = data.get("stance", "focused")
                
                if session.is_pvp and client_id != session.player1_id and client_id != session.player2_id:
                    await websocket.send_json({"type": "error", "message": "You are spectating, not fighting."})
                    continue
                
                ready = session.select_action(client_id, combat_move, stance)
                await session.broadcast_state()
                
                if ready:
                    await asyncio.sleep(0.5)
                    session.execute_round()
                    await session.broadcast_state()
                    
                    # Log battle outcome and update profiles when match concludes
                    if session.game_over:
                        p1_name = session.player1.card.card_name if session.player1 else "Unknown"
                        p2_name = session.player2.card.card_name if session.player2 else "Unknown"
                        winner_name = p1_name if session.winner == "Player 1" else p2_name
                        loser_name = p2_name if session.winner == "Player 1" else p1_name
                        mode = f"Campaign Stage {session.campaign_stage}" if session.campaign_stage else ("PvP" if session.is_pvp else "Solo")
                        db_client.log_battle(winner_name, loser_name, mode, session.round_number)
                        
                        # Update database profile if campaign/solo battle is won by Player 1
                        if not session.is_pvp and session.winner == "Player 1":
                            rewards = session.rewards
                            profile = db_client.get_profile(client_id)
                            profile["aether_dust"] = profile.get("aether_dust", 0) + rewards.get("aether_dust", 0)
                            profile["catalysts"] = profile.get("catalysts", 0) + rewards.get("catalysts", 0)
                            
                            new_stage = rewards.get("unlocked_stage")
                            if new_stage and new_stage > profile.get("unlocked_campaign_stage", 1):
                                profile["unlocked_campaign_stage"] = new_stage
                                
                                # Unlock badges
                                stage_badges = {3: "Acolyte Alchemist", 6: "Forge Master", 10: "Divine Adept"}
                                for stage_limit, badge_name in stage_badges.items():
                                    if new_stage > stage_limit and badge_name not in profile.get("badges", []):
                                        profile.setdefault("badges", []).append(badge_name)
                                        
                            db_client.update_profile(client_id, profile)

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
            if not session.members and lobby_id in battle_sessions:
                del battle_sessions[lobby_id]

@app.get("/api/feed/today", response_model=List[GameCard])
def get_today_feed():
    """Retrieve all alchemical cards forged today across the global ledger."""
    from datetime import datetime
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    
    leaderboard = db_client.get_leaderboard()
    
    # Filter cards created today
    today_cards = [c for c in leaderboard if c.get("created_date") == today_str]
    
    # Fallback: if no cards were created today, return the latest/best 12 cards to keep feed populated
    if not today_cards:
        today_cards = leaderboard[:12]
        
    return [GameCard.model_validate(c) for c in today_cards]

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

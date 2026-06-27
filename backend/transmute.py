import os
import random
import logging
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from google.genai.errors import APIError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("transmute")

# --- Pydantic Schemas ---

class CardStats(BaseModel):
    health: int = Field(description="Health points. Must be between 20 and 150.")
    attack: int = Field(description="Attack power. Must be between 20 and 150.")
    speed: int = Field(description="Speed. Must be between 20 and 150.")

class GameCard(BaseModel):
    card_name: str = Field(description="Creative, thematic name for the card based on the object.")
    element: str = Field(description="Elemental affinity. One of: Fire, Water, Lightning, Earth, Neutral.")
    base_stats: CardStats
    ability_name: str = Field(description="Name of the alchemical special ability.")
    effect_type: str = Field(description="Combat effect. One of: damage, heal, boost_speed, boost_attack, shield.")
    value: int = Field(description="Numeric value of the ability effect (e.g. amount to heal or damage). Must be between 10 and 50.")
    lore: str = Field(description="A creative 1-2 sentence story connecting the physical object to its alchemical powers.")
    image_url: str | None = None

# --- Pre-baked fallback cards for offline / missing API key mode ---

PRE_BAKED_CARDS = [
    GameCard(
        card_name="Boss Coffee Shogun",
        element="Fire",
        base_stats=CardStats(health=100, attack=80, speed=70),
        ability_name="Caffeine Overdrive",
        effect_type="boost_attack",
        value=30,
        lore="Brewed in the heart of Tokyo's vending machines. Contains enough raw alchemical energy to power a developer through a 48-hour hackathon."
    ),
    GameCard(
        card_name="Suica Ninja",
        element="Lightning",
        base_stats=CardStats(health=70, attack=60, speed=120),
        ability_name="Gate Rush",
        effect_type="boost_speed",
        value=25,
        lore="A sleek alchemical slate that grants lightning-fast travel through the Tokyo transit grid. Beeps with raw lightning power."
    ),
    GameCard(
        card_name="Famichiki Phoenix",
        element="Fire",
        base_stats=CardStats(health=120, attack=70, speed=60),
        ability_name="Crispy Heal",
        effect_type="heal",
        value=35,
        lore="The legendary crispy treat of Famima convenience stores. Transmutes greasy goodness into pure vitality and raw combat morale."
    ),
    GameCard(
        card_name="Mechanical Overlord",
        element="Earth",
        base_stats=CardStats(health=90, attack=110, speed=50),
        ability_name="Clicky Stun",
        effect_type="damage",
        value=40,
        lore="Clacked into existence by a sleep-deprived coder. Its heavy mechanical steel switches deal massive alchemical earth damage."
    ),
    GameCard(
        card_name="The Hackathon Judge",
        element="Neutral",
        base_stats=CardStats(health=80, attack=90, speed=80),
        ability_name="Final Pitch Verdict",
        effect_type="damage",
        value=50,
        lore="Equipped with a clipboard and high standards. One glare can dismiss a RAG chatbot instantly. Requires absolute visual wow-factor to appease."
    )
]

# --- Stat Balancer Utility ---

def balance_stats(stats: CardStats) -> CardStats:
    """
    Enforces the balance rule:
    1. health + attack + speed = 250 exactly.
    2. individual stats in [20, 150].
    """
    h, a, s = stats.health, stats.attack, stats.speed
    
    # 1. Clamp to individual bounds
    h = max(20, min(150, h))
    a = max(20, min(150, a))
    s = max(20, min(150, s))
    
    total = h + a + s
    if total == 250:
        return CardStats(health=h, attack=a, speed=s)
        
    # 2. Adjust proportionally to equal exactly 250
    factor = 250.0 / total
    h_adj = int(round(h * factor))
    a_adj = int(round(a * factor))
    s_adj = int(round(s * factor))
    
    # Clean up rounding errors
    diff = 250 - (h_adj + a_adj + s_adj)
    h_adj += diff
    
    # Double-check constraints
    h_adj = max(20, min(150, h_adj))
    a_adj = max(20, min(150, a_adj))
    s_adj = max(20, min(150, s_adj))
    
    # Iterative adjustment if constraints were violated
    current_sum = h_adj + a_adj + s_adj
    iterations = 0
    while current_sum != 250 and iterations < 100:
        iterations += 1
        diff = 250 - current_sum
        step = 1 if diff > 0 else -1
        
        # Try to adjust stats that won't violate boundaries
        if 20 <= h_adj + step <= 150:
            h_adj += step
        elif 20 <= a_adj + step <= 150:
            a_adj += step
        elif 20 <= s_adj + step <= 150:
            s_adj += step
        else:
            # Force it on health regardless (fallback)
            h_adj = max(20, min(150, h_adj + diff))
            break
        current_sum = h_adj + a_adj + s_adj
        
    return CardStats(health=h_adj, attack=a_adj, speed=s_adj)

# --- Primary Transmutation Function ---

async def transmute_image_to_card(image_bytes: bytes, filename: str) -> GameCard:
    """
    Takes raw image bytes, sends them to Gemini 1.5 Flash using Structured Outputs,
    performs stat balancing, and returns a fully validated GameCard.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "")
    
    if not api_key:
        logger.warning("GEMINI_API_KEY is not set. Falling back to a random pre-baked card.")
        card = random.choice(PRE_BAKED_CARDS)
        # Randomize name slightly for feel
        card_copy = card.model_copy(deep=True)
        card_copy.card_name = f"Local {card_copy.card_name}"
        return card_copy

    try:
        # Initialize Gemini Client
        client = genai.Client(api_key=api_key)
        
        # Prepare system instruction
        system_instruction = (
            "You are the Core Mechanics Engine for 'Pocket Alchemy,' a highly tactical, localized rogue-lite card game. "
            "Your job is to analyze the incoming image and extract its physical, cultural, visual, and textual properties "
            "to map them into an alchemical trading card game object.\n\n"
            "Adhere strictly to these design constraints:\n"
            "1. Card Generation Philosophy: Translate materials, colors, branding, and text into creative game mechanics. "
            "(e.g., Plastic = Low Defense/Earth, Steel = High Health/Earth, Red/Orange = Fire, Blue/Neon = Lightning/Speed).\n"
            "2. Localized Context Rule: If you detect Japanese Kanji, Katakana, Hiragana, Tokyo landmarks, or iconic "
            "Japanese products (e.g. convenience store foods like Famichiki, Boss Coffee, Suica Cards, vending machine items), "
            "you MUST grant a special ability named with regional Japanese flavor and a thematic combat bonus.\n"
            "3. Base Stats Balance: Provide health, attack, and speed values. Do your best to make their sum exactly 250, "
            "with individual stats between 20 and 150.\n"
            "4. Output format: You must return a single JSON object matching the requested schema. No conversational wrapper."
        )

        logger.info(f"Sending image {filename} to Gemini API...")
        
        # Call Gemini 2.5 Flash
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                "Transmute this object into an alchemical game card."
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GameCard,
                system_instruction=system_instruction,
                temperature=0.2
            )
        )
        
        # Parse Pydantic response directly
        card_json = response.text
        logger.info(f"Received raw JSON response: {card_json}")
        
        # Parse into Pydantic model
        card = GameCard.model_validate_json(card_json)
        
        # Ensure stats are balanced
        balanced = balance_stats(card.base_stats)
        card.base_stats = balanced
        
        logger.info(f"Successfully transmuted and balanced card: {card.card_name}")
        return card

    except APIError as e:
        logger.error(f"Gemini API Error: {e}. Falling back to pre-baked card.")
        card = random.choice(PRE_BAKED_CARDS)
        return card.model_copy(deep=True)
    except Exception as e:
        logger.error(f"Failed to transmute card: {e}. Falling back to pre-baked card.")
        card = random.choice(PRE_BAKED_CARDS)
        return card.model_copy(deep=True)

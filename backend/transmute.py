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

class GeminiGameCard(BaseModel):
    card_name: str = Field(description="Creative, thematic name for the card based on the object.")
    element: str = Field(description="Elemental affinity. One of: Fire, Water, Lightning, Earth, Neutral.")
    health: int = Field(description="Health points. Must be between 20 and 160.")
    attack: int = Field(description="Attack power. Must be between 20 and 160.")
    speed: int = Field(description="Speed. Must be between 20 and 160.")
    ability_name: str = Field(description="Name of the alchemical special ability.")
    effect_type: str = Field(description="Combat effect. One of: damage, heal, boost_speed, boost_attack, shield.")
    value: int = Field(description="Numeric value of the ability effect (e.g. amount to heal or damage). Must be between 10 and 50.")
    lore: str = Field(description="A creative 1-2 sentence story connecting the physical object to its alchemical powers.")
    uniqueness_score: int = Field(default=50, description="Rarity score of the visual object from 0 to 100.")
    uniqueness_reason: str = Field(default="", description="1-sentence explanation of the uniqueness score.")
    sub_element: str = Field(default="Aether", description="Sub-elemental affinity. One of: Plasma, Frost, Quartz, Vapor, Aether.")
    rarity: str = Field(default="Common", description="Rarity tier: Common, Rare, Epic, Legendary.")
    imagen_prompt: str = Field(default="", description="Detailed alchemical/fantasy/cyberpunk art prompt (1-2 sentences) representing the object.")

class CardStats(BaseModel):
    health: int = Field(description="Health points. Must be between 20 and 160.")
    attack: int = Field(description="Attack power. Must be between 20 and 160.")
    speed: int = Field(description="Speed. Must be between 20 and 160.")

class GameCard(BaseModel):
    card_name: str = Field(description="Creative, thematic name for the card based on the object.")
    element: str = Field(description="Elemental affinity. One of: Fire, Water, Lightning, Earth, Neutral.")
    base_stats: CardStats
    ability_name: str = Field(description="Name of the alchemical special ability.")
    effect_type: str = Field(description="Combat effect. One of: damage, heal, boost_speed, boost_attack, shield.")
    value: int = Field(description="Numeric value of the ability effect (e.g. amount to heal or damage). Must be between 10 and 50.")
    lore: str = Field(description="A creative 1-2 sentence story connecting the physical object to its alchemical powers.")
    image_url: str | None = None
    
    # --- New Gamification Fields ---
    uniqueness_score: int = Field(default=50, description="Rarity score of the visual object from 0 to 100.")
    uniqueness_reason: str = Field(default="", description="1-sentence explanation of the uniqueness score.")
    sub_element: str = Field(default="Aether", description="Sub-elemental affinity. One of: Plasma, Frost, Quartz, Vapor, Aether.")
    rarity: str = Field(default="Common", description="Rarity tier: Common, Rare, Epic, Legendary.")
    image_art_url: str | None = None
    imagen_prompt: str | None = Field(default=None, description="Detailed alchemical/fantasy/cyberpunk art prompt (1-2 sentences) representing the object.")
    created_date: str | None = None

# --- Pre-baked fallback cards for offline / missing API key mode ---

PRE_BAKED_CARDS = [
    GameCard(
        card_name="Boss Coffee Shogun",
        element="Fire",
        base_stats=CardStats(health=100, attack=80, speed=70),
        ability_name="Caffeine Overdrive",
        effect_type="boost_attack",
        value=30,
        lore="Brewed in the heart of Tokyo's vending machines. Contains enough raw alchemical energy to power a developer through a 48-hour hackathon.",
        uniqueness_score=65,
        uniqueness_reason="Branded canned coffee widely found in Tokyo vending machines.",
        sub_element="Plasma",
        rarity="Rare",
        imagen_prompt="A glowing can of canned coffee surrounded by a samurai energy aura on a dark cyberpunk Tokyo alley."
    ),
    GameCard(
        card_name="Suica Ninja",
        element="Lightning",
        base_stats=CardStats(health=70, attack=60, speed=120),
        ability_name="Gate Rush",
        effect_type="boost_speed",
        value=25,
        lore="A sleek alchemical slate that grants lightning-fast travel through the Tokyo transit grid. Beeps with raw lightning power.",
        uniqueness_score=75,
        uniqueness_reason="Tokyo transit contactless smart card containing electric sensor coils.",
        sub_element="Aether",
        rarity="Epic",
        imagen_prompt="A holographic glowing transit card speeding like a shuriken through a high-tech electronic gate corridor."
    ),
    GameCard(
        card_name="Famichiki Phoenix",
        element="Fire",
        base_stats=CardStats(health=120, attack=70, speed=60),
        ability_name="Crispy Heal",
        effect_type="heal",
        value=35,
        lore="The legendary crispy treat of Famima convenience stores. Transmutes greasy goodness into pure vitality and raw combat morale.",
        uniqueness_score=55,
        uniqueness_reason="Popular fried chicken from a local convenience store.",
        sub_element="Vapor",
        rarity="Rare",
        imagen_prompt="A phoenix bird made of golden, glowing, crispy elements rising from a convenience store food heater."
    ),
    GameCard(
        card_name="Mechanical Overlord",
        element="Earth",
        base_stats=CardStats(health=90, attack=110, speed=50),
        ability_name="Clicky Stun",
        effect_type="damage",
        value=40,
        lore="Clacked into existence by a sleep-deprived coder. Its heavy mechanical steel switches deal massive alchemical earth damage.",
        uniqueness_score=82,
        uniqueness_reason="Custom mechanical keyboard with glowing switches.",
        sub_element="Quartz",
        rarity="Epic",
        imagen_prompt="A massive golem constructed of mechanical keyboard keys, with eyes glowing with RGB light in a dark server room."
    ),
    GameCard(
        card_name="The Hackathon Judge",
        element="Neutral",
        base_stats=CardStats(health=80, attack=90, speed=80),
        ability_name="Final Pitch Verdict",
        effect_type="damage",
        value=50,
        lore="Equipped with a clipboard and high standards. One glare can dismiss a RAG chatbot instantly. Requires absolute visual wow-factor to appease.",
        uniqueness_score=98,
        uniqueness_reason="A literal legendary hackathon judge analyzing project submissions.",
        sub_element="Aether",
        rarity="Legendary",
        imagen_prompt="An austere corporate wizard holding a glowing crystalline clipboard, evaluating magical artifacts, anime fantasy style."
    )
]

# --- Stat Balancer Utility ---

def balance_stats(stats: CardStats, target_sum: int = 250) -> CardStats:
    """
    Enforces the balance rule:
    1. health + attack + speed = target_sum exactly.
    2. individual stats in [20, 160].
    """
    h, a, s = stats.health, stats.attack, stats.speed
    
    # 1. Clamp to individual bounds
    h = max(20, min(160, h))
    a = max(20, min(160, a))
    s = max(20, min(160, s))
    
    total = h + a + s
    if total == target_sum:
        return CardStats(health=h, attack=a, speed=s)
        
    # 2. Adjust proportionally to equal exactly target_sum
    factor = float(target_sum) / total
    h_adj = int(round(h * factor))
    a_adj = int(round(a * factor))
    s_adj = int(round(s * factor))
    
    # Clean up rounding errors
    diff = target_sum - (h_adj + a_adj + s_adj)
    h_adj += diff
    
    # Double-check constraints
    h_adj = max(20, min(160, h_adj))
    a_adj = max(20, min(160, a_adj))
    s_adj = max(20, min(160, s_adj))
    
    # Iterative adjustment if constraints were violated
    current_sum = h_adj + a_adj + s_adj
    iterations = 0
    while current_sum != target_sum and iterations < 100:
        iterations += 1
        diff = target_sum - current_sum
        step = 1 if diff > 0 else -1
        
        # Try to adjust stats that won't violate boundaries
        if 20 <= h_adj + step <= 160:
            h_adj += step
        elif 20 <= a_adj + step <= 160:
            a_adj += step
        elif 20 <= s_adj + step <= 160:
            s_adj += step
        else:
            # Force it on health regardless (fallback)
            h_adj = max(20, min(160, h_adj + diff))
            break
        current_sum = h_adj + a_adj + s_adj
        
    return CardStats(health=h_adj, attack=a_adj, speed=s_adj)

# --- Primary Transmutation Function ---

async def transmute_image_to_card(image_bytes: bytes, filename: str, mime_type: str = "image/jpeg") -> GameCard:
    """
    Takes raw image bytes, sends them to Gemini 2.5 Flash using Structured Outputs,
    performs stat balancing, generates stylized Imagen 3 artwork, and returns a fully validated GameCard.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "")
    
    if not api_key:
        logger.warning("GEMINI_API_KEY is not set. Falling back to a random pre-baked card.")
        card = random.choice(PRE_BAKED_CARDS)
        card_copy = card.model_copy(deep=True)
        # Give it a unique identity
        card_copy.card_name = f"Local {card_copy.card_name}"
        card_copy.uniqueness_score = random.randint(30, 95)
        if card_copy.uniqueness_score < 40:
            card_copy.rarity = "Common"
        elif card_copy.uniqueness_score < 70:
            card_copy.rarity = "Rare"
        elif card_copy.uniqueness_score < 90:
            card_copy.rarity = "Epic"
        else:
            card_copy.rarity = "Legendary"
        return card_copy

    try:
        # Initialize Gemini Client
        client = genai.Client(api_key=api_key)
        
        # Prepare system instruction with uniqueness and sub-element details
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
            "4. Uniqueness Score: Rate how unique, creative, or visually rare the captured object is on a scale of 0 to 100. "
            "A standard office/developer item (e.g. keyboard, mouse, water bottle, laptop, chair) is common (score 0-45). "
            "A branded convenience store item or local object (e.g. Boss Coffee, Pocari Sweat, train ticket) is rare (score 46-70). "
            "An interesting, colorful, custom-crafted object, or a human face/mascot is epic (score 71-89). "
            "An extremely rare, funny, or custom setup (like a live hackathon judge, a complex robot, or a rare collectible) is legendary (90-100). "
            "Provide a brief, creative uniqueness_reason.\n"
            "5. Sub-Element: Assign a sub-element based on the object's specifics. One of: Plasma, Frost, Quartz, Vapor, Aether.\n"
            "6. Rarity: Assign a rarity tier based on the uniqueness score. Common (<40), Rare (40-69), Epic (70-89), Legendary (90+).\n"
            "7. Imagen Prompt: Write a detailed alchemical/fantasy/cyberpunk art generation prompt (1-2 sentences) "
            "describing a stylized representation of the object as a magical trading card creature/relic, including a vibrant matching background. "
            "Keep the description creative, artistic, and clear for a text-to-image generator (e.g., 'A mystical glowing blue energy drink can pulsing with lightning sparks, floating in a cyberpunk neo-Tokyo street, anime fantasy trading card style').\n"
            "8. Output format: You must return a single JSON object matching the requested schema. No conversational wrapper."
        )

        logger.info(f"Sending image {filename} to Gemini API...")
        
        # Call Gemini 2.5 Flash
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                "Transmute this object into an alchemical game card."
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiGameCard,
                system_instruction=system_instruction,
                temperature=0.2
            )
        )
        
        # Parse Pydantic response directly
        card_json = response.text
        logger.info(f"Received raw JSON response: {card_json}")
        
        # Parse into GeminiGameCard model
        g_card = GeminiGameCard.model_validate_json(card_json)
        
        # Convert to GameCard
        card = GameCard(
            card_name=g_card.card_name,
            element=g_card.element,
            base_stats=CardStats(health=g_card.health, attack=g_card.attack, speed=g_card.speed),
            ability_name=g_card.ability_name,
            effect_type=g_card.effect_type,
            value=g_card.value,
            lore=g_card.lore,
            uniqueness_score=g_card.uniqueness_score,
            uniqueness_reason=g_card.uniqueness_reason,
            sub_element=g_card.sub_element,
            rarity=g_card.rarity,
            imagen_prompt=g_card.imagen_prompt if g_card.imagen_prompt else None
        )
        
        # Ensure stats are balanced
        balanced = balance_stats(card.base_stats)
        card.base_stats = balanced
        
        # --- Imagen 3 Artwork Generation ---
        if card.imagen_prompt:
            try:
                logger.info(f"Generating Imagen 3 artwork for prompt: {card.imagen_prompt}")
                art_filename = f"art_{os.path.splitext(filename)[0]}.jpg"
                uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
                art_filepath = os.path.join(uploads_dir, art_filename)
                
                img_res = client.models.generate_images(
                    model='imagen-3.0-generate-002',
                    prompt=card.imagen_prompt,
                    config=types.GenerateImagesConfig(
                        number_of_images=1,
                        aspect_ratio="1:1"
                    )
                )
                
                if img_res.generated_images:
                    gen_img = img_res.generated_images[0]
                    if hasattr(gen_img, 'image') and gen_img.image:
                        gen_img.image.save(art_filepath, format="JPEG")
                        card.image_art_url = f"/uploads/{art_filename}"
                        logger.info(f"Saved Imagen 3 artwork to {art_filepath}")
                    elif hasattr(gen_img, 'image_bytes') and gen_img.image_bytes:
                        with open(art_filepath, "wb") as f:
                            f.write(gen_img.image_bytes)
                        card.image_art_url = f"/uploads/{art_filename}"
                        logger.info(f"Saved Imagen 3 artwork (bytes) to {art_filepath}")
            except Exception as img_err:
                logger.error(f"Imagen 3 Art Generation failed: {img_err}. Continuing with raw photo only.")

        logger.info(f"Successfully transmuted card: {card.card_name} (Uniqueness: {card.uniqueness_score})")
        return card

    except APIError as e:
        logger.error(f"Gemini API Error: {e}. Falling back to pre-baked card.")
        card = random.choice(PRE_BAKED_CARDS)
        return card.model_copy(deep=True)
    except Exception as e:
        logger.error(f"Failed to transmute card: {e}. Falling back to pre-baked card.")
        card = random.choice(PRE_BAKED_CARDS)
        return card.model_copy(deep=True)


# --- Alchemical Card Fusion Function ---

async def fuse_cards(card1: GameCard, card2: GameCard, filename_seed: str) -> GameCard:
    """
    Takes two GameCards and uses Gemini to synthesize a new, balanced hybrid card.
    Also calls Imagen 3 to generate custom artwork for the fused entity.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "")
    
    if not api_key:
        logger.warning("GEMINI_API_KEY is not set. Creating manual mock card fusion.")
        # Create a basic fusion card mock
        fused_stats = CardStats(
            health=card1.base_stats.health + card2.base_stats.health,
            attack=card1.base_stats.attack + card2.base_stats.attack,
            speed=card1.base_stats.speed + card2.base_stats.speed
        )
        balanced = balance_stats(fused_stats, target_sum=270)
        
        fused = GameCard(
            card_name=f"{card1.card_name.split()[0]} {card2.card_name.split()[-1]} Fusion",
            element=random.choice(["Fire", "Lightning", "Water", "Earth"]),
            sub_element="Plasma" if card1.element != card2.element else card1.sub_element,
            base_stats=balanced,
            ability_name=f"{card1.ability_name.split()[0]} {card2.ability_name.split()[-1]} Strike",
            effect_type=card1.effect_type,
            value=max(card1.value, card2.value) + 10,
            lore=f"An alchemical synthesis blending the properties of {card1.card_name} and {card2.card_name}.",
            uniqueness_score=min(100, int((card1.uniqueness_score + card2.uniqueness_score) / 2 + 10)),
            uniqueness_reason="Fused hybrid card synthesized from two raw materials.",
            rarity="Epic",
            image_url=card1.image_url,
            image_art_url=card1.image_art_url
        )
        return fused

    try:
        client = genai.Client(api_key=api_key)
        
        fusion_instruction = (
            "You are the Alchemical Fusion Chamber. Your job is to take two alchemical cards and fuse them into a single, "
            "powerful, hybrid trading card.\n\n"
            "FUSE the following two cards:\n"
            f"Card 1: Name: {card1.card_name}, Element: {card1.element}, Sub-Element: {card1.sub_element}, Stats: Health={card1.base_stats.health}/Attack={card1.base_stats.attack}/Speed={card1.base_stats.speed}, Ability: {card1.ability_name} ({card1.effect_type}: {card1.value}), Lore: {card1.lore}\n"
            f"Card 2: Name: {card2.card_name}, Element: {card2.element}, Sub-Element: {card2.sub_element}, Stats: Health={card2.base_stats.health}/Attack={card2.base_stats.attack}/Speed={card2.base_stats.speed}, Ability: {card2.ability_name} ({card2.effect_type}: {card2.value}), Lore: {card2.lore}\n\n"
            "Design constraints:\n"
            "1. Blended Name: Combine the two names creatively (e.g. 'Boss Coffee Shogun' + 'Suica Ninja' -> 'Shogun Gate Ninja').\n"
            "2. Blended Element: Blend the elements. Neutral + anything = Aether. Fire + Lightning = Plasma. Water + Lightning = Plasma. Fire + Water = Vapor. Water + Earth = Frost. Earth + Lightning = Quartz. Or select one representing the stronger trait.\n"
            "3. Stats Balance: Sum of health, attack, and speed must be exactly 270 (fusion cards get a stats boost!). Make each individual stat between 20 and 160.\n"
            "4. Ability: Create a new alchemical special ability combining elements of both card abilities. It should be highly creative and powerful.\n"
            "5. Effect Type: One of: damage, heal, boost_speed, boost_attack, shield.\n"
            "6. Value: Numeric effect value must be between 15 and 60 (stronger than standard cards).\n"
            "7. Lore: A hilarious or epic story about how the alchemical combination of the two physical objects formed this powerful hybrid.\n"
            "8. Rarity: Always Epic or Legendary.\n"
            "9. Uniqueness Score: Take the average of both uniqueness scores plus 10 (clamped to a max of 100).\n"
            "10. Imagen Prompt: Write a detailed alchemical/fantasy/cyberpunk art prompt (1-2 sentences) showing a fused hybrid visual representing BOTH parent objects dynamically. Keep it high quality.\n"
            "11. Output format: You must return a single JSON object matching the requested schema. No conversational wrapper."
        )

        logger.info(f"Fusing {card1.card_name} + {card2.card_name} via Gemini API...")
        
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents="Perform the alchemical fusion.",
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiGameCard,
                system_instruction=fusion_instruction,
                temperature=0.4
            )
        )
        
        card_json = response.text
        logger.info(f"Received fusion raw JSON: {card_json}")
        
        # Parse into GeminiGameCard model
        g_fused = GeminiGameCard.model_validate_json(card_json)
        
        # Convert to GameCard
        fused_card = GameCard(
            card_name=g_fused.card_name,
            element=g_fused.element,
            base_stats=CardStats(health=g_fused.health, attack=g_fused.attack, speed=g_fused.speed),
            ability_name=g_fused.ability_name,
            effect_type=g_fused.effect_type,
            value=g_fused.value,
            lore=g_fused.lore,
            uniqueness_score=g_fused.uniqueness_score,
            uniqueness_reason=g_fused.uniqueness_reason,
            sub_element=g_fused.sub_element,
            rarity=g_fused.rarity,
            imagen_prompt=g_fused.imagen_prompt if g_fused.imagen_prompt else None
        )
        
        # Ensure fused stats are balanced to 270
        fused_card.base_stats = balance_stats(fused_card.base_stats, target_sum=270)
        
        # inherit one of the raw uploaded images for thumbnail fallback
        fused_card.image_url = card1.image_url if card1.image_url else card2.image_url
        
        # Generate fused artwork via Imagen 3
        if fused_card.imagen_prompt:
            try:
                logger.info(f"Generating Imagen 3 artwork for fusion: {fused_card.imagen_prompt}")
                art_filename = f"fuse_{filename_seed}.jpg"
                uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
                art_filepath = os.path.join(uploads_dir, art_filename)
                
                img_res = client.models.generate_images(
                    model='imagen-3.0-generate-002',
                    prompt=fused_card.imagen_prompt,
                    config=types.GenerateImagesConfig(
                        number_of_images=1,
                        aspect_ratio="1:1"
                    )
                )
                
                if img_res.generated_images:
                    gen_img = img_res.generated_images[0]
                    if hasattr(gen_img, 'image') and gen_img.image:
                        gen_img.image.save(art_filepath, format="JPEG")
                        fused_card.image_art_url = f"/uploads/{art_filename}"
                        logger.info(f"Saved fused Imagen 3 artwork to {art_filepath}")
                    elif hasattr(gen_img, 'image_bytes') and gen_img.image_bytes:
                        with open(art_filepath, "wb") as f:
                            f.write(gen_img.image_bytes)
                        fused_card.image_art_url = f"/uploads/{art_filename}"
                        logger.info(f"Saved fused Imagen 3 artwork (bytes) to {art_filepath}")
            except Exception as img_err:
                logger.error(f"Imagen 3 Fused Art Generation failed: {img_err}. Falling back.")
                fused_card.image_art_url = card1.image_art_url if card1.image_art_url else card2.image_art_url
                
        return fused_card
        
    except Exception as e:
        logger.error(f"Failed card fusion: {e}. Returning manual fallback.")
        # Return fallback fusion card
        fused_stats = CardStats(
            health=card1.base_stats.health + card2.base_stats.health,
            attack=card1.base_stats.attack + card2.base_stats.attack,
            speed=card1.base_stats.speed + card2.base_stats.speed
        )
        balanced = balance_stats(fused_stats, target_sum=270)
        return GameCard(
            card_name=f"{card1.card_name.split()[0]} {card2.card_name.split()[-1]} Hybrid",
            element=card1.element,
            sub_element="Plasma",
            base_stats=balanced,
            ability_name=f"{card1.ability_name} Surge",
            effect_type=card1.effect_type,
            value=card1.value + 10,
            lore="A fused hybrid alchemical card.",
            uniqueness_score=min(100, int((card1.uniqueness_score + card2.uniqueness_score) / 2 + 10)),
            rarity="Epic"
        )

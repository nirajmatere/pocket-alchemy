import asyncio
import random
import logging
from typing import Dict, Any, List, Optional
from fastapi import WebSocket
from backend.transmute import GameCard, CardStats

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("battle")

# --- Elemental Multiplier Table ---
MULTIPLIERS = {
    ("Fire", "Earth"): 1.5,
    ("Earth", "Lightning"): 1.5,
    ("Lightning", "Water"): 1.5,
    ("Water", "Fire"): 1.5,
    # Weaknesses
    ("Earth", "Fire"): 0.7,
    ("Lightning", "Earth"): 0.7,
    ("Water", "Lightning"): 0.7,
    ("Fire", "Water"): 0.7,
}

def get_element_multiplier(attacker_element: str, defender_element: str) -> float:
    return MULTIPLIERS.get((attacker_element, defender_element), 1.0)

# --- Default AI Bosses (Campaign Stages 1 to 10) ---
CAMPAIGN_BOSSES = [
    GameCard(
        card_name="Akihabara Maid Golem",
        element="Lightning",
        base_stats=CardStats(health=150, attack=50, speed=50),
        ability_name="Moe Moe Discharge",
        effect_type="damage",
        value=20,
        lore="Constructed from spare arcade motherboards. Distributes tea and electric shocks in equal measures.",
        sub_element="Plasma",
        rarity="Common"
    ),
    GameCard(
        card_name="Sumo Steam Roller",
        element="Earth",
        base_stats=CardStats(health=180, attack=60, speed=40),
        ability_name="Heavy Sumo Slam",
        effect_type="shield",
        value=0,
        lore="A heavy alchemical engine designed in Ryogoku. Crushes standard decks with earth-shattering pressure.",
        sub_element="Quartz",
        rarity="Common"
    ),
    GameCard(
        card_name="Shibuya Crossing Spirit",
        element="Neutral",
        base_stats=CardStats(health=200, attack=70, speed=65),
        ability_name="Crosswalk Slipstream",
        effect_type="boost_speed",
        value=20,
        lore="Born from the footprints of Tokyo's busiest crossing. Moves in chaotic speed bursts.",
        sub_element="Aether",
        rarity="Rare"
    ),
    GameCard(
        card_name="Suntory Shogun",
        element="Fire",
        base_stats=CardStats(health=230, attack=80, speed=60),
        ability_name="Whisky Flareup",
        effect_type="boost_attack",
        value=20,
        lore="Fuelled by vending machine highballs. Increases raw combat power rapidly.",
        sub_element="Plasma",
        rarity="Rare"
    ),
    GameCard(
        card_name="Asakusa Lantern Dragon",
        element="Fire",
        base_stats=CardStats(health=260, attack=90, speed=55),
        ability_name="Senzoji Red Ember",
        effect_type="damage",
        value=30,
        lore="A celestial dragon manifesting from the giant red lanterns of Asakusa. Radiates immense fire energy.",
        sub_element="Plasma",
        rarity="Rare"
    ),
    GameCard(
        card_name="Meiji Forest Tengu",
        element="Earth",
        base_stats=CardStats(health=290, attack=100, speed=80),
        ability_name="Wind Gale Deflection",
        effect_type="shield",
        value=0,
        lore="An ancient bird-spirit guarding the Meiji Shrine woods. Swift and highly protective.",
        sub_element="Quartz",
        rarity="Epic"
    ),
    GameCard(
        card_name="Tsukiji Kraken",
        element="Water",
        base_stats=CardStats(health=320, attack=110, speed=70),
        ability_name="Wasabi Splash",
        effect_type="damage",
        value=40,
        lore="A gargantuan squid hiding in the outer seafood market docks. Deals spicy water damage.",
        sub_element="Vapor",
        rarity="Epic"
    ),
    GameCard(
        card_name="Shinkansen Oni",
        element="Lightning",
        base_stats=CardStats(health=350, attack=125, speed=110),
        ability_name="Super-Express Strike",
        effect_type="boost_speed",
        value=30,
        lore="An alchemical demon fused with a bullet train. Striking with lightning speed.",
        sub_element="Plasma",
        rarity="Epic"
    ),
    GameCard(
        card_name="Kabukicho Neon Drake",
        element="Water",
        base_stats=CardStats(health=400, attack=140, speed=95),
        ability_name="Cyber-Glow Heal",
        effect_type="heal",
        value=45,
        lore="A cybernetic serpent reflecting the neon lights of Shinjuku. Absorbs ambient light to mend wounds.",
        sub_element="Vapor",
        rarity="Legendary"
    ),
    GameCard(
        card_name="The Ultimate Hackathon Judge",
        element="Neutral",
        base_stats=CardStats(health=500, attack=160, speed=100),
        ability_name="No-Code Dismissal",
        effect_type="damage",
        value=60,
        lore="The final gatekeeper. Armed with clipboard matrix diagnostics. One glance will dissolve standard systems.",
        sub_element="Aether",
        rarity="Legendary"
    )
]

# Legacy fallback for old references
AI_BOSSES = CAMPAIGN_BOSSES[:3]


class ActiveFighter:
    """Tracks active combat stats, shielding, and temporary buffs of a card during a match."""
    def __init__(self, card: GameCard):
        self.card = card
        self.max_health = card.base_stats.health
        self.current_health = card.base_stats.health
        self.attack = card.base_stats.attack
        self.speed = card.base_stats.speed
        
        # Battle states
        self.shield_active = False
        self.ability_cooldown = 0
        self.attack_buff = 0
        self.speed_buff = 0
        self.stance: Optional[str] = "focused"  # default stance: "aggressive", "defensive", "focused"

    def apply_damage(self, damage: int) -> int:
        if self.shield_active:
            self.shield_active = False
            return 0  # Damage fully blocked
            
        # Defensive stance flat damage reduction
        flat_reduction = 15 if self.stance == "defensive" else 0
        actual_damage = max(5, int(damage) - flat_reduction)
        
        self.current_health = max(0, self.current_health - actual_damage)
        return actual_damage

    def heal(self, amount: int) -> int:
        heal_amount = max(0, int(amount))
        previous_health = self.current_health
        self.current_health = min(self.max_health, self.current_health + heal_amount)
        return self.current_health - previous_health

    def reset_cooldown(self):
        self.ability_cooldown = 3 # Cooldown in rounds

    def tick_cooldown(self):
        if self.ability_cooldown > 0:
            # Focused stance decreases cooldown twice as fast
            decrement = 2 if self.stance == "focused" else 1
            self.ability_cooldown = max(0, self.ability_cooldown - decrement)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "card_name": self.card.card_name,
            "element": self.card.element,
            "sub_element": self.card.sub_element,
            "rarity": self.card.rarity,
            "max_health": self.max_health,
            "current_health": self.current_health,
            "attack": self.attack + self.attack_buff,
            "speed": self.speed + self.speed_buff,
            "shield_active": self.shield_active,
            "ability_cooldown": self.ability_cooldown,
            "ability_name": self.card.ability_name,
            "effect_type": self.card.effect_type,
            "value": self.card.value,
            "lore": self.card.lore,
            "image_url": self.card.image_url,
            "image_art_url": self.card.image_art_url,
            "stance": self.stance
        }

def generate_post_match_analysis(winner: ActiveFighter, loser: ActiveFighter) -> str:
    w_name = winner.card.card_name
    l_name = loser.card.card_name
    w_elem = winner.card.element
    l_elem = loser.card.element
    
    elem_mult = get_element_multiplier(w_elem, l_elem)
    elem_reason = ""
    if elem_mult > 1.0:
        elem_reason = f" • Elemental Advantage: {w_name}'s {w_elem} affinity dealt 1.5x alchemical counters against {l_name}'s {l_elem} structure."
        
    speed_reason = ""
    if winner.speed > loser.speed:
        speed_reason = f" • Initiative Speed: {w_name} had superior turn speed ({winner.speed} vs {loser.speed}), striking first to secure combat tempo."
        
    ability_reason = f" • Special Activation: Leveraging alchemical skill '{winner.card.ability_name}' ({winner.card.effect_type}) turned the tides of battle."

    stance_reason = f" • Tactical Stance: Stance '{winner.stance}' provided crucial mechanical support."

    return (
        f"🏆 {w_name} defeated {l_name}!\n"
        f"=== ALCHEMICAL COMBAT DEBRIEF ===\n"
        f"{elem_reason}\n"
        f"{speed_reason}\n"
        f"{ability_reason}\n"
        f"{stance_reason}"
    )


class BattleSession:
    """Manages a single battle room serving multiple members (Lobby, Challenges, Spectators, Fights)."""
    def __init__(self, lobby_id: str, player1_card: GameCard, is_pvp: bool = False, opponent_card: GameCard = None, campaign_stage: Optional[int] = None):
        self.lobby_id = lobby_id
        self.is_pvp = is_pvp
        self.campaign_stage = campaign_stage
        
        # Members dictionary: client_id -> {"card": GameCard, "status": str, "ws": WebSocket}
        self.members: Dict[str, Dict[str, Any]] = {}
        
        # Combat setup
        self.player1: Optional[ActiveFighter] = None
        self.player2: Optional[ActiveFighter] = None
        self.player1_id: Optional[str] = None
        self.player2_id: Optional[str] = None
        
        # Actions locked: {"action": "attack"/"ability", "stance": "aggressive"/"defensive"/"focused"}
        self.player1_action: Optional[Dict[str, str]] = None
        self.player2_action: Optional[Dict[str, str]] = None
        
        self.round_number = 1
        self.game_over = False
        self.winner = ""
        self.combat_logs = []
        self.post_match_summary = ""
        self.rewards = {}

        # Pre-populate player 1 if card provided
        if player1_card:
            self.player1 = ActiveFighter(player1_card)
            self.player1_id = "1"
            self.members["1"] = {
                "client_id": "1",
                "card": player1_card,
                "status": "fighting" if is_pvp else "spectating",
                "ws": None
            }

        # Pre-populate solo battle if not PvP
        if not is_pvp:
            if campaign_stage is not None and 1 <= campaign_stage <= len(CAMPAIGN_BOSSES):
                opp_card = CAMPAIGN_BOSSES[campaign_stage - 1]
                self.combat_logs = [f"Campaign Stage {campaign_stage} started! You face {opp_card.card_name}."]
            else:
                opp_card = opponent_card if opponent_card else random.choice(AI_BOSSES)
                self.combat_logs = [f"Solo Match started! You face {opp_card.card_name}."]
                
            self.player2 = ActiveFighter(opp_card)
            self.player2_id = "boss"

    def join_opponent(self, card: GameCard):
        """Allows direct opponent assignment (used for non-lobby or test scenarios)."""
        self.player2_id = "2"
        self.player2 = ActiveFighter(card)
        self.members["2"] = {
            "client_id": "2",
            "card": card,
            "status": "fighting",
            "ws": None
        }

    def register_member(self, client_id: str, card: GameCard, ws: WebSocket):
        """Adds a member to the room lobby list."""
        self.members[client_id] = {
            "client_id": client_id,
            "card": card,
            "status": "spectating",
            "ws": ws
        }
        # If is_pvp and player 1 ID is not registered or is the "1" placeholder, assign it
        if self.is_pvp and (not self.player1_id or self.player1_id == "1"):
            if "1" in self.members and client_id != "1":
                del self.members["1"]
            self.player1_id = client_id
            self.player1 = ActiveFighter(card)
            self.members[client_id]["status"] = "fighting"

    def remove_member(self, client_id: str):
        """Removes a member. Resets active battles if a fighter leaves."""
        if client_id in self.members:
            del self.members[client_id]
        
        if client_id == self.player1_id or client_id == self.player2_id:
            self.game_over = True
            self.winner = "Opponent (Disconnected)"
            self.combat_logs.append("⚠️ A fighter disconnected. Arena protocol terminated.")
            self.player1_id = None
            self.player2_id = None

    def challenge_player(self, challenger_id: str, target_id: str) -> bool:
        """Initiates a challenge in the room."""
        if challenger_id not in self.members or target_id not in self.members:
            return False
        
        self.members[challenger_id]["status"] = "challenging"
        self.members[target_id]["status"] = "challenged"
        return True

    def accept_challenge(self, host_id: str, challenger_id: str) -> bool:
        """Accepts the challenge, starts the PvP arena loop."""
        if host_id not in self.members or challenger_id not in self.members:
            return False
        
        self.player1_id = challenger_id
        self.player2_id = host_id
        
        self.player1 = ActiveFighter(self.members[challenger_id]["card"])
        self.player2 = ActiveFighter(self.members[host_id]["card"])
        
        self.members[challenger_id]["status"] = "fighting"
        self.members[host_id]["status"] = "fighting"
        
        self.round_number = 1
        self.game_over = False
        self.winner = ""
        self.post_match_summary = ""
        self.rewards = {}
        self.combat_logs = [f"⚔️ Match started: {self.player1.card.card_name} vs {self.player2.card.card_name}!"]
        return True

    def select_action(self, client_id: Any, action: str, stance: str = "focused") -> bool:
        """Registers a fighter action and stance. Returns True if both are locked in."""
        if self.game_over:
            return False

        action_struct = {"action": action, "stance": stance}

        if not self.is_pvp:
            # Solo Match action registration
            self.player1_action = action_struct
            
            # Solo AI stance selection
            boss_stance = random.choice(["aggressive", "defensive", "focused"])
            boss_move = "attack"
            if self.player2.ability_cooldown == 0 and random.random() < 0.4:
                boss_move = "ability"
            
            self.player2_action = {"action": boss_move, "stance": boss_stance}
            return True

        # PvP action registration
        if client_id == 1 or client_id == "1" or client_id == self.player1_id:
            self.player1_action = action_struct
            self.combat_logs.append(f"⚡ {self.player1.card.card_name} locked in their turn action.")
        elif client_id == 2 or client_id == "2" or client_id == self.player2_id:
            self.player2_action = action_struct
            self.combat_logs.append(f"⚡ {self.player2.card.card_name} locked in their turn action.")
            
        return self.player1_action is not None and self.player2_action is not None

    def execute_round(self):
        """Resolves the turn round in speed order with tactical stance modifiers."""
        if self.game_over or not self.player1 or not self.player2:
            return

        # Apply locked stances to ActiveFighter objects
        self.player1.stance = self.player1_action["stance"]
        self.player2.stance = self.player2_action["stance"]

        self.player1.tick_cooldown()
        self.player2.tick_cooldown()

        p1_action = self.player1_action["action"]
        p2_action = self.player2_action["action"]

        # Calculate modified speeds based on stance
        p1_spd = self.player1.speed + self.player1.speed_buff
        if self.player1.stance == "focused":
            p1_spd = int(p1_spd * 1.25)
        elif self.player1.stance == "aggressive":
            p1_spd = int(p1_spd * 0.9)

        p2_spd = self.player2.speed + self.player2.speed_buff
        if self.player2.stance == "focused":
            p2_spd = int(p2_spd * 1.25)
        elif self.player2.stance == "aggressive":
            p2_spd = int(p2_spd * 0.9)

        # Speed ordering resolution
        if p1_spd == p2_spd:
            p1_first = random.choice([True, False])
        else:
            p1_first = p1_spd > p2_spd

        self.combat_logs.append(f"--- Resolve Round {self.round_number} ---")
        self.combat_logs.append(f"📣 Stance Active: {self.player1.card.card_name} [{self.player1.stance.upper()}] | {self.player2.card.card_name} [{self.player2.stance.upper()}]")

        first_fighter = self.player1 if p1_first else self.player2
        first_action = p1_action if p1_first else p2_action
        first_label = "Player 1" if p1_first else "Player 2"

        second_fighter = self.player2 if p1_first else self.player1
        second_action = p2_action if p1_first else p1_action
        second_label = "Player 2" if p1_first else "Player 1"

        # First strike
        self.resolve_action(first_fighter, second_fighter, first_action)
        
        if second_fighter.current_health <= 0:
            self.game_over = True
            self.winner = first_label
            self.combat_logs.append(f"🏆 {first_fighter.card.card_name} wins the match!")
            self.post_match_summary = generate_post_match_analysis(first_fighter, second_fighter)
            self.calculate_rewards(first_label)
            self.reset_lobby_status()
            return

        # Second strike
        self.resolve_action(second_fighter, first_fighter, second_action)

        if first_fighter.current_health <= 0:
            self.game_over = True
            self.winner = second_label
            self.combat_logs.append(f"🏆 {second_fighter.card.card_name} wins the match!")
            self.post_match_summary = generate_post_match_analysis(second_fighter, first_fighter)
            self.calculate_rewards(second_label)
            self.reset_lobby_status()
            return

        self.round_number += 1
        self.player1_action = None
        self.player2_action = None

    def resolve_action(self, attacker: ActiveFighter, defender: ActiveFighter, action: str):
        """Calculates normal hits or alchemical spell effects factoring in active stance modifiers."""
        if attacker.current_health <= 0:
            return

        if action == "attack":
            base_dmg = attacker.attack + attacker.attack_buff
            
            # Stance damage multipliers
            if attacker.stance == "aggressive":
                base_dmg = int(base_dmg * 1.2)
            elif attacker.stance == "defensive":
                base_dmg = int(base_dmg * 0.8)
                
            variance = random.uniform(0.9, 1.1)
            raw_dmg = base_dmg * variance
            mult = get_element_multiplier(attacker.card.element, defender.card.element)
            final_dmg = int(raw_dmg * mult)
            
            blocked = defender.shield_active
            actual_dmg = defender.apply_damage(final_dmg)
            
            elem_msg = f" ({mult}x Element Match!)" if mult > 1.0 else f" ({mult}x Disadvantage)" if mult < 1.0 else ""
            stance_msg = " [AGGRESSIVE Strike]" if attacker.stance == "aggressive" else " [DEFENSIVE Poke]" if attacker.stance == "defensive" else ""
            
            if blocked:
                self.combat_logs.append(f"🛡️ {defender.card.card_name} blocked {attacker.card.card_name}'s strike!")
            else:
                self.combat_logs.append(f"⚔️ {attacker.card.card_name} hits {defender.card.card_name} for {actual_dmg} damage!{elem_msg}{stance_msg}")

        elif action == "ability":
            eff = attacker.card.effect_type
            val = attacker.card.value
            
            # Ability value slight buff if aggressive, or extra speed focus
            if attacker.stance == "aggressive" and eff == "damage":
                val = int(val * 1.15)
                
            ability_name = attacker.card.ability_name
            self.combat_logs.append(f"✨ {attacker.card.card_name} casts {ability_name}!")
            
            if eff == "damage":
                actual_dmg = defender.apply_damage(val)
                self.combat_logs.append(f"💥 Magical ability deals {actual_dmg} direct damage to {defender.card.card_name}!")
            elif eff == "heal":
                healed = attacker.heal(val)
                self.combat_logs.append(f"❤️ Healed for +{healed} HP! ({attacker.current_health}/{attacker.max_health})")
            elif eff == "boost_attack":
                attacker.attack_buff += val
                self.combat_logs.append(f"💪 Attack temporarily boosted by +{val}!")
            elif eff == "boost_speed":
                attacker.speed_buff += val
                self.combat_logs.append(f"⚡ Speed temporarily boosted by +{val}!")
            elif eff == "shield":
                attacker.shield_active = True
                self.combat_logs.append(f"🛡️ Alchemical shield active! Blocks next normal strike.")
            
            attacker.reset_cooldown()

    def calculate_rewards(self, winner_label: str):
        """Generates match rewards (aether dust, catalysts) for the winner."""
        # For PvP, rewards go to player1 or player2. For Campaign, player1 is the user.
        self.rewards = {
            "aether_dust": 0,
            "catalysts": 0,
            "unlocked_stage": None
        }
        
        # Determine if Player 1 (user) won
        p1_won = (winner_label == "Player 1")
        
        if p1_won:
            # Base aether dust reward
            dust = random.randint(40, 80)
            
            # Add multiplier if beating a campaign stage
            if self.campaign_stage is not None:
                # Stage reward multiplier
                stage_mult = 1.0 + (self.campaign_stage * 0.2)
                dust = int(dust * stage_mult)
                
                # Check catalyst drop chance (increases on higher campaign stages)
                catalyst_chance = 0.3 + (self.campaign_stage * 0.05)
                catalysts = 1 if random.random() < catalyst_chance else 0
                
                self.rewards["unlocked_stage"] = self.campaign_stage + 1
            else:
                # PvP or random PvE match rewards
                catalysts = 1 if random.random() < 0.25 else 0
                
            self.rewards["aether_dust"] = dust
            self.rewards["catalysts"] = catalysts
            self.combat_logs.append(f"🎁 Reward Awarded: +{dust} Aether Dust, +{catalysts} Fusion Catalysts!")

    def reset_lobby_status(self):
        """Returns fighting players back to spectating status after a match."""
        for client_id in self.members:
            self.members[client_id]["status"] = "spectating"
        self.player1_action = None
        self.player2_action = None

    async def broadcast_state(self):
        """Pipes the room dashboard payload to all active connections in this lobby."""
        members_list = [
            {
                "client_id": m["client_id"],
                "card_name": m["card"].card_name if m["card"] else "Unregistered",
                "status": m["status"]
            }
            for m in self.members.values()
        ]
        
        # Construct current arena state
        active_match = None
        if self.player1 and self.player2:
            active_match = {
                "player1_id": self.player1_id,
                "player2_id": self.player2_id,
                "player1": self.player1.to_dict(),
                "player2": self.player2.to_dict(),
                "round_number": self.round_number,
                "game_over": self.game_over,
                "winner": self.winner,
                "logs": self.combat_logs[-10:],
                "post_match_summary": self.post_match_summary,
                "rewards": self.rewards,
                "campaign_stage": self.campaign_stage
            }
            
        payload = {
            "type": "room_state",
            "lobby_id": self.lobby_id,
            "is_pvp": self.is_pvp,
            "members": members_list,
            "active_match": active_match
        }
        
        for m in list(self.members.values()):
            if m["ws"] is None:
                continue
            try:
                await m["ws"].send_json(payload)
            except Exception as e:
                logger.error(f"Failed broadcasting to client {m['client_id']}: {e}")

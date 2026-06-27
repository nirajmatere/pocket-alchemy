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

# --- Default AI Bosses (for PvE) ---
AI_BOSSES = [
    GameCard(
        card_name="Tokyo Tower Golem",
        element="Earth",
        base_stats=CardStats(health=350, attack=60, speed=40),
        ability_name="Neon Fortification",
        effect_type="shield",
        value=30,
        lore="An iron construct infused with Tokyo's neon skyline. Slow but incredibly durable."
    ),
    GameCard(
        card_name="Suntory Shogun",
        element="Fire",
        base_stats=CardStats(health=240, attack=90, speed=70),
        ability_name="Whisky Burnout",
        effect_type="boost_attack",
        value=20,
        lore="An alchemical warrior powered by local highballs and caffeinated energy drinks. Deals high damage."
    ),
    GameCard(
        card_name="Pixelated Kappa",
        element="Water",
        base_stats=CardStats(health=280, attack=70, speed=90),
        ability_name="Digital Splash",
        effect_type="damage",
        value=35,
        lore="A digital trickster emerging from Sumida River. Uses holographic water blasts to disrupt opponents."
    )
]

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

    def apply_damage(self, damage: int) -> int:
        if self.shield_active:
            self.shield_active = False
            return 0  # Damage fully blocked
        actual_damage = max(5, int(damage))
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
            self.ability_cooldown -= 1

    def to_dict(self) -> Dict[str, Any]:
        return {
            "card_name": self.card.card_name,
            "element": self.card.element,
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
            "image_url": self.card.image_url
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

    return (
        f"🏆 {w_name} defeated {l_name}!\n"
        f"=== ALCHEMICAL COMBAT DEBRIEF ===\n"
        f"{elem_reason}\n"
        f"{speed_reason}\n"
        f"{ability_reason}"
    )


class BattleSession:
    """Manages a single battle room serving multiple members (Lobby, Challenges, Spectators, Fights)."""
    def __init__(self, lobby_id: str, player1_card: GameCard, is_pvp: bool = False, opponent_card: GameCard = None):
        self.lobby_id = lobby_id
        self.is_pvp = is_pvp
        
        # Members dictionary: client_id -> {"card": GameCard, "status": str, "ws": WebSocket}
        self.members: Dict[str, Dict[str, Any]] = {}
        
        # Combat setup
        self.player1: Optional[ActiveFighter] = None
        self.player2: Optional[ActiveFighter] = None
        self.player1_id: Optional[str] = None
        self.player2_id: Optional[str] = None
        self.player1_action: Optional[str] = None
        self.player2_action: Optional[str] = None
        
        self.round_number = 1
        self.game_over = False
        self.winner = ""
        self.combat_logs = []
        self.post_match_summary = ""

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
            opp_card = opponent_card if opponent_card else random.choice(AI_BOSSES)
            self.player2 = ActiveFighter(opp_card)
            self.player2_id = "boss"
            self.combat_logs = [f"Solo Match started! You face {self.player2.card.card_name}."]

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
            # Clean up the placeholder key if it exists
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
        
        # Update statuses
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
        self.combat_logs = [f"⚔️ Match started: {self.player1.card.card_name} vs {self.player2.card.card_name}!"]
        return True

    def select_action(self, client_id: Any, action: str) -> bool:
        """Registers a fighter action. Returns True if both are locked in."""
        if self.game_over:
            return False

        if not self.is_pvp:
            # Solo Match action registration
            self.player1_action = action
            boss_action = "attack"
            if self.player2.ability_cooldown == 0 and random.random() < 0.35:
                boss_action = "ability"
            self.player2_action = boss_action
            return True

        # PvP action registration
        if client_id == 1 or client_id == "1" or client_id == self.player1_id:
            self.player1_action = action
            self.combat_logs.append(f"⚡ {self.player1.card.card_name} locked their action.")
        elif client_id == 2 or client_id == "2" or client_id == self.player2_id:
            self.player2_action = action
            self.combat_logs.append(f"⚡ {self.player2.card.card_name} locked their action.")
            
        return self.player1_action is not None and self.player2_action is not None

    def execute_round(self):
        """Resolves the turn round in speed order."""
        if self.game_over or not self.player1 or not self.player2:
            return

        self.player1.tick_cooldown()
        self.player2.tick_cooldown()

        p1_action = self.player1_action
        p2_action = self.player2_action

        # Speed ordering
        p1_spd = self.player1.speed + self.player1.speed_buff
        p2_spd = self.player2.speed + self.player2.speed_buff
        
        if p1_spd == p2_spd:
            p1_first = random.choice([True, False])
        else:
            p1_first = p1_spd > p2_spd

        self.combat_logs.append(f"--- Resolve Round {self.round_number} ---")

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
            self.reset_lobby_status()
            return

        # Second strike
        self.resolve_action(second_fighter, first_fighter, second_action)

        if first_fighter.current_health <= 0:
            self.game_over = True
            self.winner = second_label
            self.combat_logs.append(f"🏆 {second_fighter.card.card_name} wins the match!")
            self.post_match_summary = generate_post_match_analysis(second_fighter, first_fighter)
            self.reset_lobby_status()
            return

        self.round_number += 1
        self.player1_action = None
        self.player2_action = None

    def resolve_action(self, attacker: ActiveFighter, defender: ActiveFighter, action: str):
        """Calculates normal hits or alchemical spell effects."""
        if attacker.current_health <= 0:
            return

        if action == "attack":
            base_dmg = attacker.attack + attacker.attack_buff
            variance = random.uniform(0.9, 1.1)
            raw_dmg = base_dmg * variance
            mult = get_element_multiplier(attacker.card.element, defender.card.element)
            final_dmg = int(raw_dmg * mult)
            
            blocked = defender.shield_active
            actual_dmg = defender.apply_damage(final_dmg)
            
            elem_msg = f" ({mult}x Element Match!)" if mult > 1.0 else f" ({mult}x Disadvantage)" if mult < 1.0 else ""
            if blocked:
                self.combat_logs.append(f"🛡️ {defender.card.card_name} blocked {attacker.card.card_name}'s strike!")
            else:
                self.combat_logs.append(f"⚔️ {attacker.card.card_name} hits {defender.card.card_name} for {actual_dmg} damage!{elem_msg}")

        elif action == "ability":
            eff = attacker.card.effect_type
            val = attacker.card.value
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
                "post_match_summary": self.post_match_summary
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

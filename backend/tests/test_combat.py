import pytest
from backend.transmute import balance_stats, CardStats, GameCard
from backend.battle import get_element_multiplier, ActiveFighter, BattleSession

# --- Stat Balancing Tests ---

def test_balance_stats_exact():
    """Verify that if stats already sum to 250 and are within bounds, they are unchanged."""
    stats = CardStats(health=100, attack=80, speed=70)
    balanced = balance_stats(stats)
    assert balanced.health == 100
    assert balanced.attack == 80
    assert balanced.speed == 70
    assert (balanced.health + balanced.attack + balanced.speed) == 250

def test_balance_stats_scaling():
    """Verify stats are scaled proportionally when they sum to more or less than 250."""
    # Sum is 300
    stats = CardStats(health=100, attack=100, speed=100)
    balanced = balance_stats(stats)
    assert (balanced.health + balanced.attack + balanced.speed) == 250
    assert 20 <= balanced.health <= 150
    assert 20 <= balanced.attack <= 150
    assert 20 <= balanced.speed <= 150

    # Sum is 150
    stats2 = CardStats(health=50, attack=50, speed=50)
    balanced2 = balance_stats(stats2)
    assert (balanced2.health + balanced2.attack + balanced2.speed) == 250

def test_balance_stats_boundaries():
    """Verify that individual stats are strictly clamped within [20, 150]."""
    # Extreme low
    stats = CardStats(health=10, attack=15, speed=10)
    balanced = balance_stats(stats)
    assert balanced.health >= 20
    assert balanced.attack >= 20
    assert balanced.speed >= 20
    assert (balanced.health + balanced.attack + balanced.speed) == 250

    # Extreme high
    stats2 = CardStats(health=500, attack=10, speed=10)
    balanced2 = balance_stats(stats2)
    assert balanced2.health <= 160
    assert (balanced2.health + balanced2.attack + balanced2.speed) == 250


# --- Combat Logic Tests ---

def test_element_multipliers():
    """Verify elemental counter system multipliers."""
    # Fire beats Earth
    assert get_element_multiplier("Fire", "Earth") == 1.5
    # Earth beats Lightning
    assert get_element_multiplier("Earth", "Lightning") == 1.5
    # Lightning beats Water
    assert get_element_multiplier("Lightning", "Water") == 1.5
    # Water beats Fire
    assert get_element_multiplier("Water", "Fire") == 1.5
    
    # Non-advantage
    assert get_element_multiplier("Fire", "Water") == 0.7
    assert get_element_multiplier("Neutral", "Fire") == 1.0

def test_active_fighter_shielding():
    """Verify that alchemical shields block the next strike and then expire."""
    card = GameCard(
        card_name="Test Card",
        element="Neutral",
        base_stats=CardStats(health=100, attack=50, speed=100),
        ability_name="Shield Block",
        effect_type="shield",
        value=0,
        lore="Testing shield mechanism"
    )
    
    fighter = ActiveFighter(card)
    fighter.shield_active = True
    
    # Shield active -> should take 0 damage
    damage_taken = fighter.apply_damage(50)
    assert damage_taken == 0
    assert fighter.current_health == 100
    assert not fighter.shield_active # shield should be consumed
    
    # Shield consumed -> should take full damage
    damage_taken_2 = fighter.apply_damage(30)
    assert damage_taken_2 == 30
    assert fighter.current_health == 70

def test_active_fighter_healing():
    """Verify alchemical healing raises health but never exceeds maximum capacity."""
    card = GameCard(
        card_name="Test Card",
        element="Neutral",
        base_stats=CardStats(health=100, attack=50, speed=100),
        ability_name="Heal Up",
        effect_type="heal",
        value=30,
        lore="Testing heal mechanism"
    )
    
    fighter = ActiveFighter(card)
    fighter.current_health = 85
    
    # Healing for 30 should cap health at 100
    healed = fighter.heal(30)
    assert healed == 15
    assert fighter.current_health == 100

def test_battle_round_resolution_pve():
    """Verify a PvE turn round executes cleanly and health pools decrease."""
    card1 = GameCard(
        card_name="P1 Card",
        element="Fire",
        base_stats=CardStats(health=100, attack=50, speed=120), # fast card
        ability_name="Strike",
        effect_type="damage",
        value=20,
        lore="First attacker"
    )
    card2 = GameCard(
        card_name="Boss Card",
        element="Earth",
        base_stats=CardStats(health=100, attack=40, speed=50), # slow card
        ability_name="Slam",
        effect_type="damage",
        value=15,
        lore="Second attacker"
    )
    
    # We initialize session manually to verify
    session = BattleSession("lobby_test", card1, is_pvp=False)
    session.player2 = ActiveFighter(card2) # override random boss with card2
    
    # Select player 1 action (it will auto-trigger boss action)
    ready = session.select_action(1, "attack")
    assert ready is True
    
    session.execute_round()
    
    # P1 is faster (120 speed > 50 speed), so P1 hits boss first.
    # P1 is Fire, boss is Earth (1.5x elemental advantage).
    # Boss health must be decreased
    assert session.player2.current_health < 100
    assert session.round_number == 2

def test_battle_round_resolution_pvp():
    """Verify a PvP turn round resolves only after both players select actions."""
    card1 = GameCard(
        card_name="P1 Card",
        element="Fire",
        base_stats=CardStats(health=100, attack=50, speed=120),
        ability_name="Strike",
        effect_type="damage",
        value=20,
        lore="First attacker"
    )
    card2 = GameCard(
        card_name="P2 Card",
        element="Earth",
        base_stats=CardStats(health=100, attack=40, speed=50),
        ability_name="Slam",
        effect_type="damage",
        value=15,
        lore="Second attacker"
    )
    
    session = BattleSession("lobby_test", card1, is_pvp=True)
    session.join_opponent(card2)
    
    # Player 1 locks in action -> should not be ready
    ready = session.select_action(1, "attack")
    assert ready is False
    assert session.player1_action["action"] == "attack"
    assert session.player2_action is None
    
    # Player 2 locks in action -> should be ready
    ready = session.select_action(2, "attack")
    assert ready is True
    assert session.player2_action["action"] == "attack"
    
    # Execute round
    session.execute_round()
    assert session.player2.current_health < 100
    assert session.round_number == 2
    assert session.player1_action is None
    assert session.player2_action is None


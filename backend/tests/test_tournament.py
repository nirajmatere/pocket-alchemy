import pytest
from backend.transmute import GameCard, CardStats
from backend.battle import BattleSession

def test_tournament_owner_and_registration():
    """Verify that the first registered member becomes the owner and cards can be registered/updated."""
    card1 = GameCard(
        card_name="Player 1 Card",
        element="Fire",
        base_stats=CardStats(health=100, attack=50, speed=100),
        ability_name="Fire Blast",
        effect_type="damage",
        value=20,
        lore="P1 Champion"
    )
    card2 = GameCard(
        card_name="Player 2 Card",
        element="Water",
        base_stats=CardStats(health=100, attack=40, speed=110),
        ability_name="Water Spray",
        effect_type="damage",
        value=15,
        lore="P2 Champion"
    )

    session = BattleSession("ROOM-TEST", None, is_pvp=True)
    assert session.owner_id is None

    # Register client 1 (no card initially)
    session.register_member("client1", None, None)
    assert session.owner_id == "client1"
    assert session.members["client1"]["card"] is None
    assert session.members["client1"]["status"] == "spectating"

    # Register client 2 with card
    session.register_member("client2", card2, None)
    assert session.owner_id == "client1"  # Owner remains client1
    assert session.members["client2"]["card"] == card2
    assert session.members["client2"]["status"] == "spectating"

    # Update client 1 with card
    session.register_member("client1", card1, None)
    assert session.members["client1"]["card"] == card1
    assert session.player1.card == card1


def test_tournament_owner_transfer():
    """Verify room owner role transfers when the current owner leaves."""
    session = BattleSession("ROOM-TEST", None, is_pvp=True)
    session.register_member("client1", None, None)
    session.register_member("client2", None, None)
    session.register_member("client3", None, None)

    assert session.owner_id == "client1"

    # Client 1 leaves
    session.remove_member("client1")
    assert session.owner_id == "client2"

    # Client 2 leaves
    session.remove_member("client2")
    assert session.owner_id == "client3"

    # Client 3 leaves
    session.remove_member("client3")
    assert session.owner_id is None


def test_tournament_simulation_round_robin():
    """Verify that start_tournament runs all matches and computes the leaderboard correctly."""
    c1 = GameCard(
        card_name="Fire Mage",
        element="Fire",
        base_stats=CardStats(health=100, attack=60, speed=100),
        ability_name="Spitfire",
        effect_type="damage",
        value=30,
        lore="Aggressive"
    )
    c2 = GameCard(
        card_name="Earth Golem",
        element="Earth",
        base_stats=CardStats(health=120, attack=40, speed=80),
        ability_name="Stomp",
        effect_type="shield",
        value=0,
        lore="Tanky"
    )
    c3 = GameCard(
        card_name="Lightning Sprite",
        element="Lightning",
        base_stats=CardStats(health=80, attack=50, speed=120),
        ability_name="Zap",
        effect_type="damage",
        value=20,
        lore="Fast"
    )

    session = BattleSession("ROOM-TEST", None, is_pvp=True)
    session.register_member("p1", c1, None)
    session.register_member("p2", c2, None)
    session.register_member("p3", c3, None)

    # Run tournament
    success = session.start_tournament()
    assert success is True
    assert session.tournament_active is True

    # 3 participants => 3 combinations: (p1, p2), (p1, p3), (p2, p3)
    assert len(session.tournament_matches) == 3
    assert len(session.tournament_leaderboard) == 3

    # Check leaderboard integrity
    leaderboard = session.tournament_leaderboard
    assert leaderboard[0]["points"] >= leaderboard[1]["points"]
    assert leaderboard[1]["points"] >= leaderboard[2]["points"]

    # Verify wins + losses + draws match
    for row in leaderboard:
        total_games = row["wins"] + row["losses"] + row["draws"]
        assert total_games == 2  # Each plays 2 games in a 3-player round robin
        calculated_points = row["wins"] * 3 + row["draws"] * 1
        assert row["points"] == calculated_points

    # Reset
    session.reset_tournament()
    assert session.tournament_active is False
    assert len(session.tournament_matches) == 0
    assert len(session.tournament_leaderboard) == 0
    for m in session.members.values():
        assert m["status"] == "spectating"

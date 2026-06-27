import os
import pytest
from fastapi.testclient import TestClient
from backend.main import app, db_client
from backend.transmute import GameCard, CardStats

client = TestClient(app)

def test_today_feed_endpoint():
    """Verify that today's feed endpoint returns a valid list of cards (either filtered or fallback)."""
    response = client.get("/api/feed/today")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    
    # Leaderboard fallback or actual today feed items must validate as GameCards
    if len(data) > 0:
        card = data[0]
        assert "card_name" in card
        assert "element" in card
        assert "base_stats" in card

def test_create_battle_with_custom_opponent():
    """Verify that we can initialize a PvE battle session against a specified custom opponent card."""
    # Ensure there's at least one card in the inventory to play with
    inventory = db_client.get_inventory("local_user")
    if not inventory:
        # Save a dummy card
        dummy = GameCard(
            card_name="Dummy Card",
            element="Neutral",
            base_stats=CardStats(health=100, attack=50, speed=100),
            ability_name="Dummy Shield",
            effect_type="shield",
            value=0,
            lore="Dummy lore"
        )
        db_client.save_card("local_user", dummy)
        inventory = db_client.get_inventory("local_user")

    player_card_name = inventory[0]["card_name"]
    
    # Define custom opponent card
    opponent = GameCard(
        card_name="Dark Alchemist",
        element="Fire",
        base_stats=CardStats(health=120, attack=60, speed=70),
        ability_name="Pyro Blast",
        effect_type="damage",
        value=30,
        lore="A dark shadow opponent."
    )
    
    response = client.post("/api/battle/create", json={
        "client_id": "local_user",
        "card_name": player_card_name,
        "is_pvp": False,
        "opponent_card": opponent.model_dump()
    })
    
    assert response.status_code == 200
    res_data = response.json()
    assert "lobby_id" in res_data
    assert "boss_name" in res_data
    assert res_data["boss_name"] == "Dark Alchemist"


def test_user_segregation_local_db():
    """Verify that inventory retrieval is segregated by client_id in local fallback."""
    # Save a card for user A
    card_a = GameCard(
        card_name="User A Card",
        element="Fire",
        base_stats=CardStats(health=100, attack=50, speed=100),
        ability_name="A Blast",
        effect_type="damage",
        value=20,
        lore="User A card lore"
    )
    db_client.save_card("user_a", card_a)
    
    # Save a card for user B
    card_b = GameCard(
        card_name="User B Card",
        element="Water",
        base_stats=CardStats(health=100, attack=50, speed=100),
        ability_name="B Splash",
        effect_type="heal",
        value=20,
        lore="User B card lore"
    )
    db_client.save_card("user_b", card_b)
    
    # Retrieve user A's inventory
    inv_a = db_client.get_inventory("user_a")
    # Retrieve user B's inventory
    inv_b = db_client.get_inventory("user_b")
    
    names_a = [c["card_name"] for c in inv_a]
    names_b = [c["card_name"] for c in inv_b]
    
    assert "User A Card" in names_a
    assert "User B Card" not in names_a
    assert "User B Card" in names_b
    assert "User A Card" not in names_b

@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GCP_PROJECT_ID"),
    reason="Skipping because Gemini API credentials are not configured in the environment"
)
def test_battle_agent_play_endpoint():
    """Verify that the Gemini-powered Managed Battle Agent can successfully play a turn."""
    # Ensure there's a card in inventory
    inventory = db_client.get_inventory("local_user")
    if not inventory:
        dummy = GameCard(
            card_name="Dummy Card",
            element="Neutral",
            base_stats=CardStats(health=100, attack=50, speed=100),
            ability_name="Dummy Shield",
            effect_type="shield",
            value=0,
            lore="Dummy lore"
        )
        db_client.save_card("local_user", dummy)
        inventory = db_client.get_inventory("local_user")

    player_card_name = inventory[0]["card_name"]
    
    # Create battle session
    create_res = client.post("/api/battle/create", json={
        "client_id": "local_user",
        "card_name": player_card_name,
        "is_pvp": False
    })
    assert create_res.status_code == 200
    lobby_id = create_res.json()["lobby_id"]
    
    # Trigger agent play
    agent_res = client.post("/api/battle/agent_play", json={
        "client_id": "local_user",
        "lobby_id": lobby_id
    })
    assert agent_res.status_code == 200
    agent_data = agent_res.json()
    assert "action" in agent_data
    assert "stance" in agent_data
    assert "reasoning" in agent_data
    assert agent_data["action"] in ["attack", "ability"]
    assert agent_data["stance"] in ["aggressive", "defensive", "focused"]



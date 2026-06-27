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

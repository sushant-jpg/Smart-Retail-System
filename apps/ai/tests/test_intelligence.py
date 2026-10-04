from datetime import date, timedelta

from fastapi.testclient import TestClient  # type: ignore[import-not-found]

from app.main import app

client = TestClient(app)


def test_recommendations_are_explainable_and_exclude_cart_items():
    response = client.post("/recommendations", json={
        "recent_categories": ["Coffee", "Coffee", "Snacks"],
        "cart_product_ids": ["in-cart"],
        "candidates": [
            {"product_id": "in-cart", "name": "Beans", "category": "Coffee", "in_stock": True},
            {"product_id": "filters", "name": "Filters", "category": "Coffee", "in_stock": True, "bought_with_cart_count": 8},
            {"product_id": "sold-out", "name": "Mug", "category": "Home", "in_stock": False, "trending_score": 1},
        ],
    })
    assert response.status_code == 200
    result = response.json()["recommendations"]
    assert [item["product_id"] for item in result] == ["filters"]
    assert result[0]["reason"]
    assert result[0]["signals"]


def test_forecast_detects_stockout_risk_and_reorder_need():
    start = date(2026, 1, 1)
    history = [{"day": str(start + timedelta(days=index)), "quantity": 10 + index} for index in range(7)]
    response = client.post("/forecast", json={
        "history": history,
        "horizon_days": 7,
        "current_stock": 5,
        "supplier_lead_days": 4,
        "safety_stock_days": 2,
    })
    assert response.status_code == 200
    result = response.json()
    assert result["predicted_demand"] > 0
    assert result["suggested_reorder_quantity"] > 0
    assert result["stock_out_risk"] == "HIGH"
    assert "estimates" in result["disclaimer"]

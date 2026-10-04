from collections import Counter
from datetime import date
from math import ceil
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field, model_validator

app = FastAPI(
    title="SmartRetail Intelligence API",
    version="0.1.0",
    description="Explainable recommendation and demand estimates. Outputs are decision support, not guarantees.",
)


class CandidateProduct(BaseModel):
    product_id: str
    name: str
    category: str
    in_stock: bool = True
    trending_score: float = Field(default=0, ge=0, le=1)
    bought_with_cart_count: int = Field(default=0, ge=0)


class RecommendationRequest(BaseModel):
    recent_categories: list[str] = Field(default_factory=list, max_length=100)
    cart_product_ids: list[str] = Field(default_factory=list, max_length=100)
    candidates: list[CandidateProduct] = Field(min_length=1, max_length=1000)
    limit: int = Field(default=6, ge=1, le=30)


class Recommendation(BaseModel):
    product_id: str
    confidence: float
    reason: str
    signals: list[str]


class RecommendationResponse(BaseModel):
    recommendations: list[Recommendation]
    strategy: Literal["explainable-weighted-ranking"] = "explainable-weighted-ranking"
    disclaimer: str = "Recommendations are estimates based on supplied behavioral and popularity signals."


@app.post("/recommendations", response_model=RecommendationResponse)
def recommendations(payload: RecommendationRequest) -> RecommendationResponse:
    preferences = Counter(category.casefold() for category in payload.recent_categories)
    strongest_category = preferences.most_common(1)[0][0] if preferences else None
    cart = set(payload.cart_product_ids)
    ranked: list[tuple[float, Recommendation]] = []

    for product in payload.candidates:
        if not product.in_stock or product.product_id in cart:
            continue
        preference_strength = min(preferences[product.category.casefold()] / 5, 1.0)
        basket_strength = min(product.bought_with_cart_count / 10, 1.0) if cart else 0
        score = 0.50 * preference_strength + 0.30 * basket_strength + 0.20 * product.trending_score
        signals: list[str] = []
        if preference_strength:
            signals.append("category preference")
        if basket_strength:
            signals.append("frequently bought with cart items")
        if product.trending_score >= 0.5:
            signals.append("recent store popularity")

        if preference_strength and product.category.casefold() == strongest_category:
            reason = f"You frequently purchase products in {product.category}."
        elif basket_strength:
            reason = "Customers often purchase this with items in your cart."
        else:
            reason = "This product is currently popular in this store."

        ranked.append((score, Recommendation(
            product_id=product.product_id,
            confidence=round(min(max(score, 0.05), 0.95), 2),
            reason=reason,
            signals=signals or ["catalogue fallback"],
        )))

    ranked.sort(key=lambda entry: (-entry[0], entry[1].product_id))
    return RecommendationResponse(recommendations=[item for _, item in ranked[: payload.limit]])


class DailySales(BaseModel):
    day: date
    quantity: int = Field(ge=0)


class ForecastRequest(BaseModel):
    history: list[DailySales] = Field(min_length=3, max_length=365)
    horizon_days: int = Field(default=7, ge=1, le=90)
    current_stock: int = Field(ge=0)
    supplier_lead_days: int = Field(default=3, ge=0, le=180)
    safety_stock_days: int = Field(default=2, ge=0, le=90)

    @model_validator(mode="after")
    def unique_sorted_days(self):
        days = [entry.day for entry in self.history]
        if len(days) != len(set(days)):
            raise ValueError("history must contain one observation per day")
        return self


class ForecastResponse(BaseModel):
    predicted_demand: int
    daily_run_rate: float
    suggested_reorder_quantity: int
    stock_out_risk: Literal["LOW", "MEDIUM", "HIGH"]
    method: Literal["weighted-moving-average-with-trend"] = "weighted-moving-average-with-trend"
    disclaimer: str = "Forecasts are estimates and require manager review before purchasing."


@app.post("/forecast", response_model=ForecastResponse)
def forecast(payload: ForecastRequest) -> ForecastResponse:
    ordered = sorted(payload.history, key=lambda value: value.day)
    recent = ordered[-14:]
    weights = list(range(1, len(recent) + 1))
    weighted_average = sum(point.quantity * weight for point, weight in zip(recent, weights)) / sum(weights)

    window = max(1, min(7, len(recent) // 2))
    old_average = sum(point.quantity for point in recent[:window]) / window
    new_average = sum(point.quantity for point in recent[-window:]) / window
    daily_trend = (new_average - old_average) / max(len(recent) - window, 1)

    horizon_demand = max(0, weighted_average * payload.horizon_days + daily_trend * payload.horizon_days / 2)
    predicted = ceil(horizon_demand)
    cover_days = payload.supplier_lead_days + payload.safety_stock_days
    target_stock = ceil(max(0, weighted_average + daily_trend) * cover_days)
    suggested = max(0, target_stock - payload.current_stock)
    demand_during_lead = max(0, weighted_average * max(payload.supplier_lead_days, 1))
    coverage_ratio = payload.current_stock / max(demand_during_lead, 1)
    risk: Literal["LOW", "MEDIUM", "HIGH"] = "HIGH" if coverage_ratio < 0.75 else "MEDIUM" if coverage_ratio < 1.25 else "LOW"

    return ForecastResponse(
        predicted_demand=predicted,
        daily_run_rate=round(weighted_average, 2),
        suggested_reorder_quantity=suggested,
        stock_out_risk=risk,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy", "service": "smartretail-intelligence"}

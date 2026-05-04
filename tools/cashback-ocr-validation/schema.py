"""
Pydantic schemas for the receipt-extraction response.

Used both as:
  1. The Gemini structured-output `response_schema` (via .model_json_schema())
  2. Local validation after the call returns
"""

from typing import List, Optional
from pydantic import BaseModel, Field


class ReceiptItem(BaseModel):
    name: str = Field(description="Produktbezeichnung wie auf dem Bon")
    qty: float = Field(description="Menge (1 wenn nicht angegeben)", default=1)
    priceCents: int = Field(description="Endpreis dieser Zeile in Cents")
    unitPriceCents: Optional[int] = Field(default=None, description="Stückpreis in Cents oder null")
    category: Optional[str] = Field(default=None, description="Grobe Kategorie oder null")


class Receipt(BaseModel):
    isReceipt: bool = Field(description="True wenn das Bild ein Kassenbon ist")
    notReceiptReason: Optional[str] = Field(default=None, description="Falls isReceipt=false: warum")

    merchant: Optional[str] = Field(default=None, description="Filialname (z. B. ALDI SÜD)")
    merchantSubtitle: Optional[str] = Field(default=None, description="Filialadresse / Nummer")

    bonDate: Optional[str] = Field(default=None, description="ISO-8601 YYYY-MM-DD")
    bonTime: Optional[str] = Field(default=None, description="HH:MM (24h)")

    items: List[ReceiptItem] = Field(default_factory=list)

    subtotalCents: Optional[int] = Field(default=None, description="Zwischensumme")
    totalCents: Optional[int] = Field(default=None, description="Endbetrag in Cents")
    paymentMethod: Optional[str] = Field(default=None, description="Bar / EC / Karte / null")

    suspiciousManipulation: bool = Field(default=False, description="Manipulationsspuren erkennbar")
    manipulationNotes: Optional[str] = Field(default=None)

    ocrConfidence: Optional[float] = Field(
        default=None,
        ge=0,
        le=1,
        description="Selbsteinschätzung 0..1 wie sicher die Extraktion war",
    )
